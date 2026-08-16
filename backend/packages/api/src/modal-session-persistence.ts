import type { VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

/**
 * A short-lived, single-purpose credential created by a customer's own
 * backend (with its project API key) so it can hand a POWEROTP-hosted
 * modal to the end user without ever knowing that end user's phone number
 * up front — see `backend/packages/api/src/modal-session-service.ts` and
 * `docs/AS_BUILT.md`'s "Hosted verification modal" section. The session id
 * itself is the credential for the public, session-scoped routes; nothing
 * about a project's API key or callback configuration is ever stored here.
 */
export interface ModalSessionDocument {
  _id: string;
  projectId: string;
  customerId: string;
  allowedTypes: VerificationType[];
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * A raw "possible bot" signal captured when something follows the hidden
 * "Website AI index summary" honeypot link on a hosted modal page (see
 * `frontend/app/widget/[sessionId]/page.tsx` and the logging route under
 * `backend/apps/server/app/v1/modal-sessions/[sessionId]/ai-index-summary/route.ts`).
 * Deliberately just a raw signal — no scoring, blocking, or relationship to
 * the (placeholder-only, this session) Power Passport concept yet; a future
 * bot-blocker phase is what would consume this.
 */
export interface BotSignalDocument {
  _id: string;
  source: "widget_honeypot";
  projectId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  occurredAt: Date;
}

const MODAL_SESSION_TTL_SECONDS = 24 * 60 * 60;
const BOT_SIGNAL_RETENTION_SECONDS = 90 * 24 * 60 * 60;

export async function ensureModalSessionIndexes(db: Db) {
  await Promise.all([
    db
      .collection<ModalSessionDocument>("modalSessions")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<ModalSessionDocument>("modalSessions")
      .createIndex({ projectId: 1, createdAt: -1 }),
    db
      .collection<BotSignalDocument>("botSignals")
      .createIndex({ occurredAt: 1 }, { expireAfterSeconds: BOT_SIGNAL_RETENTION_SECONDS }),
  ]);
}

export { MODAL_SESSION_TTL_SECONDS };
