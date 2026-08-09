import type { ModalSessionConfig, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

import { MODAL_SESSION_TTL_SECONDS, type ModalSessionDocument } from "./modal-session-persistence.js";
import type { ProjectDocument } from "./persistence.js";
import { createSortableId } from "./security.js";

/** A session can be used to start this many verification attempts before
 * it's exhausted — generous enough to let an end user retry a busy/
 * no-answer call with a different method or number, tight enough that one
 * session can't be turned into a call-spam vector. */
export const MODAL_SESSION_MAX_ATTEMPTS = 3;

export class ModalSessionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/**
 * Backs the hosted verification modal (`/widget/{sessionId}`) — see
 * `docs/AS_BUILT.md`'s "Hosted verification modal" section. A session is
 * created by a customer's own backend (with its project API key, before
 * any interaction exists) and is the sole credential the public,
 * session-scoped routes accept afterward; it never carries a project's
 * API key, callback URL, or any other project secret.
 */
export class ModalSessionService {
  readonly #sessions;

  constructor(db: Db) {
    this.#sessions = db.collection<ModalSessionDocument>("modalSessions");
  }

  /**
   * `allowedTypes` is always checked against the project's own real
   * `enabledMethods` — a caller can narrow what the modal offers (e.g. only
   * `sms_code`) but can never smuggle in a method the project hasn't
   * actually enabled.
   */
  async createSession(
    project: Pick<ProjectDocument, "_id" | "customerId" | "enabledMethods">,
    requestedTypes: VerificationType[] | undefined,
  ) {
    const allowedTypes = requestedTypes ?? project.enabledMethods;
    if (allowedTypes.length === 0) {
      throw new ModalSessionError("no_methods_available", 409);
    }
    for (const type of allowedTypes) {
      if (!project.enabledMethods.includes(type)) {
        throw new ModalSessionError("method_not_enabled", 403);
      }
    }

    const now = new Date();
    const session: ModalSessionDocument = {
      _id: createSortableId("mss"),
      projectId: project._id,
      customerId: project.customerId,
      allowedTypes,
      attempts: 0,
      maxAttempts: MODAL_SESSION_MAX_ATTEMPTS,
      createdAt: now,
      expiresAt: new Date(now.getTime() + MODAL_SESSION_TTL_SECONDS * 1_000),
    };
    await this.#sessions.insertOne(session);
    return session;
  }

  /** Fails closed (not-found) for a missing, unknown, or already-expired
   * session — a manual `expiresAt` check matters because MongoDB's TTL
   * background task only sweeps periodically, not the instant a document
   * expires. */
  async #requireActive(sessionId: string): Promise<ModalSessionDocument> {
    const session = await this.#sessions.findOne({ _id: sessionId });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new ModalSessionError("modal_session_not_found", 404);
    }
    return session;
  }

  async get(sessionId: string): Promise<ModalSessionDocument> {
    return this.#requireActive(sessionId);
  }

  async config(sessionId: string, projectName: string): Promise<ModalSessionConfig> {
    const session = await this.#requireActive(sessionId);
    return {
      sessionId: session._id,
      projectName,
      allowedTypes: session.allowedTypes,
      attemptsRemaining: Math.max(0, session.maxAttempts - session.attempts),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Atomically claims one attempt slot. Returns the now-active session on
   * success; throws once every allowed attempt has already been spent.
   * Deliberately does not distinguish a failed attempt from a successful
   * one here — the caller decides whether a terminal success should also
   * stop future attempts (it doesn't need to: the underlying verification
   * itself is already resolved, so a further "retry" would just create a
   * separate one, still bounded by this same cap).
   */
  async recordAttempt(sessionId: string): Promise<ModalSessionDocument> {
    const session = await this.#requireActive(sessionId);
    if (session.attempts >= session.maxAttempts) {
      throw new ModalSessionError("modal_session_attempts_exhausted", 429);
    }

    const updated = await this.#sessions.findOneAndUpdate(
      { _id: sessionId, attempts: session.attempts },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ModalSessionError("modal_session_attempts_exhausted", 429);
    return updated;
  }
}
