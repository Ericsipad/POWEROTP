import type { ProjectAuthSessionReport } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type {
  AdSystemDocument,
  ProjectAuthSessionDocument,
} from "./accounting-persistence.js";

const EVENT_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1_000;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export class ProjectAuthSessionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

export class ProjectAuthSessionService {
  readonly #sessions;
  readonly #adSystems;

  constructor(db: Db) {
    this.#sessions = db.collection<ProjectAuthSessionDocument>("projectAuthSessions");
    this.#adSystems = db.collection<AdSystemDocument>("adSystems");
  }

  async report(
    projectId: string,
    customerId: string,
    idempotencyKey: string,
    input: ProjectAuthSessionReport,
  ): Promise<{ document: ProjectAuthSessionDocument; replayed: boolean }> {
    const occurredAt = new Date(input.occurredAt);
    const now = new Date();
    if (
      occurredAt.getTime() > now.getTime() + 60_000 ||
      occurredAt.getTime() < now.getTime() - EVENT_LOOKBACK_MS
    ) {
      throw new ProjectAuthSessionError("event_timestamp_out_of_range", 400);
    }
    const existing = await this.#sessions.findOne({ projectId, idempotencyKey });
    if (existing) {
      const matches =
        existing._id === input.sessionId &&
        existing.eventType === input.eventType &&
        existing.occurredAt.getTime() === occurredAt.getTime() &&
        existing.adSlotsAllotted === input.adSlotsAllotted &&
        existing.adSlotsFilled === input.adSlotsFilled &&
        existing.adSystemId === input.adSystemId;
      if (!matches) throw new ProjectAuthSessionError("idempotency_conflict", 409);
      return { document: existing, replayed: true };
    }
    const adSystem = await this.#adSystems.findOne({ _id: input.adSystemId, active: true });
    if (!adSystem) throw new ProjectAuthSessionError("ad_system_unavailable", 400);
    const document: ProjectAuthSessionDocument = {
      _id: input.sessionId,
      projectId,
      customerId,
      eventType: input.eventType,
      occurredAt,
      adSlotsAllotted: input.adSlotsAllotted,
      adSlotsFilled: input.adSlotsFilled,
      adSystemId: input.adSystemId,
      idempotencyKey,
      reportedAt: now,
    };
    try {
      await this.#sessions.insertOne(document);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const replay = await this.#sessions.findOne({ projectId, idempotencyKey });
      if (replay) return this.report(projectId, customerId, idempotencyKey, input);
      throw new ProjectAuthSessionError("session_already_reported", 409);
    }
    return { document, replayed: false };
  }

  async summary(projectId: string, now = new Date()) {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const [signupCount30Days, signinCount30Days] = await Promise.all([
      this.#sessions.countDocuments({ projectId, eventType: "signup", occurredAt: { $gte: since, $lte: now } }),
      this.#sessions.countDocuments({ projectId, eventType: "signin", occurredAt: { $gte: since, $lte: now } }),
    ]);
    return { projectId, signupCount30Days, signinCount30Days };
  }
}
