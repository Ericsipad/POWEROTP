import type { AccountClass, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

import { ensureChallengeIndexes } from "./challenge-persistence.js";
import { ensureVerificationIndexes } from "./verification-persistence.js";

export interface UserDocument {
  _id: string;
  email: string;
  passwordHash: string;
  accountClass: AccountClass;
  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDocument {
  _id: string;
  userId: string;
  csrfHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface EmailVerificationDocument {
  _id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ProjectDocument {
  _id: string;
  customerId: string;
  name: string;
  slug: string;
  enabledMethods: VerificationType[];
  allowedOrigins: string[];
  callbackUrl?: string;
  callbackSecretEncrypted?: string;
  active: boolean;
  activatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyDocument {
  _id: string;
  projectId: string;
  customerId: string;
  keyHash: string;
  prefix: string;
  lastFour: string;
  createdAt: Date;
  revokedAt?: Date;
}

/**
 * A node authenticates with the shared `NODE_SECRET` (see `NodeService`);
 * this document is purely a visibility/heartbeat record of which source
 * IPs have successfully authenticated, not an access-control record
 * itself.
 */
export interface NodeTrunkStatus {
  id: string;
  registrationState: "Registered" | "Rejected" | "Unregistered" | "Unknown";
  healthy: boolean;
  consecutiveFailures: number;
  downUntil?: number;
}

export interface NodeDocument {
  _id: string;
  ip: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Last self-reported trunk status from this node — see
   * `NodeService#reportTrunkStatus` and `docs/AS_BUILT.md`'s "Admin
   * operator health dashboard" section. Absent until an agent build new
   * enough to report it has polled at least once. */
  trunkStatus?: NodeTrunkStatus[];
  trunkStatusReportedAt?: Date;
}

/**
 * Cooldown state for one platform alert condition (see
 * `apps/api/src/alerting-service.ts`) — keyed by a stable condition key
 * (e.g. `queue_backlog:verification-jobs`, `node_stale:node_abc123`) so
 * `apps/api/src/alert-dispatcher.ts` doesn't re-email the admin for the
 * same still-ongoing problem more than once per `ALERT_COOLDOWN_MS`.
 */
export interface AlertStateDocument {
  _id: string;
  lastAlertedAt: Date;
}

export interface AuditDocument {
  _id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: Date;
  ip?: string;
  details?: Record<string, string | number | boolean>;
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection<UserDocument>("users").createIndex({ email: 1 }, { unique: true }),
    db
      .collection<SessionDocument>("sessions")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<SessionDocument>("sessions")
      .createIndex({ userId: 1, expiresAt: -1 }),
    db
      .collection<EmailVerificationDocument>("emailVerifications")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<ProjectDocument>("projects")
      .createIndex({ slug: 1 }, { unique: true }),
    db
      .collection<ProjectDocument>("projects")
      .createIndex({ customerId: 1, createdAt: -1 }),
    db
      .collection<ApiKeyDocument>("apiKeys")
      .createIndex({ keyHash: 1 }, { unique: true }),
    db
      .collection<ApiKeyDocument>("apiKeys")
      .createIndex({ projectId: 1, revokedAt: 1 }),
    db
      .collection<AuditDocument>("auditEvents")
      .createIndex({ actorId: 1, occurredAt: -1 }),
    db.collection<NodeDocument>("nodes").createIndex({ ip: 1 }, { unique: true }),
  ]);
  await ensureVerificationIndexes(db);
  await ensureChallengeIndexes(db);
}
