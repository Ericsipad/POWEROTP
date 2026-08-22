import type {
  AccountClass,
  HostedAuthIdentityDataMode,
  ProjectIdentifierString,
  VerificationType,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import { ensureAccountingIndexes } from "./accounting-persistence.js";
import { ensureBillingIndexes } from "./billing-persistence.js";
import { ensureBotBlockerAsnClassificationIndexes } from "./botblocker-asn-classification-persistence.js";
import { ensureBotBlockerAsnTypeScoreIndexes } from "./botblocker-asn-type-score-persistence.js";
import { ensureFingerprintDataIndexes } from "./botblocker-fingerprint-persistence.js";
import { ensureBotBlockerIntelligenceIndexes } from "./botblocker-intelligence-persistence.js";
import { ensureBotBlockerIpApiLookupIndexes } from "./botblocker-ip-api-lookup-persistence.js";
import { ensureBotBlockerIpBlacklistIndexes } from "./botblocker-ip-blacklist-persistence.js";
import { ensureBotBlockerNetworkRangeIndexes } from "./botblocker-network-range-persistence.js";
import { ensureBotBlockerPolicyIndexes } from "./botblocker-policy-persistence.js";
import { ensureBotBlockerProfileScoringIndexes } from "./botblocker-profile-scoring-persistence.js";
import { ensureBotBlockerRiskEventScoringIndexes } from "./botblocker-risk-event-scoring-persistence.js";
import { ensureBotBlockerSiteCredentialIndexes } from "./botblocker-site-credential-persistence.js";
import { ensureBotBlockerSiteIndexes } from "./botblocker-site-persistence.js";
import { ensureChallengeIndexes } from "./challenge-persistence.js";
import { ensureModalSessionIndexes } from "./modal-session-persistence.js";
import { ensureVerificationIndexes } from "./verification-persistence.js";

/**
 * The single platform admin's fixed user id (see `AuthService#loginAdmin`)
 * and, separately, the owner of the operator-configured demo project (see
 * `ProjectService#ensureDemoProject`). Also used by
 * `backend/packages/api/src/balance-service.ts` as the one customer id that is never
 * billed — there is no real customer balance behind the marketing demo.
 */
export const PLATFORM_ADMIN_USER_ID = "usr_platform_admin";

export interface UserDocument {
  _id: string;
  /**
   * Authenticated-encrypted with `PII_ENCRYPTION_KEY`, never plaintext —
   * see that config field's doc comment. Decrypt via
   * `backend/packages/api/src/auth-service.ts#decryptEmail`, only when actually needed.
   */
  emailEncrypted: string;
  /**
   * A deterministic HMAC of the lowercased/trimmed email under
   * `EMAIL_LOOKUP_HASH_SECRET` — the unique lookup index this collection is
   * actually queried by (login, duplicate-registration checks), since
   * `emailEncrypted` can never be queried against directly.
   */
  emailLookupHash: string;
  passwordHash: string;
  accountClass: AccountClass;
  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A minimal, deliberately PII-free companion to `UserDocument` — just the
 * id and signup timestamp, nothing else. Data-minimization / SOC 2-oriented
 * design: any service that only needs "is this a real customer account,
 * and when was it created" (e.g. `backend/packages/api/src/usage-quota-service.ts`)
 * should read this instead of `UserDocument` (which carries `email` and
 * `passwordHash`), so most of the codebase never has a reason to touch the
 * one collection holding real customer PII/credentials at all — only
 * `AuthService` (which owns login/verification) does. Every real customer
 * account has exactly one row here, inserted at the same time as its
 * `UserDocument` (`AuthService#register`).
 */
export interface CustomerAccountDocument {
  _id: string;
  createdAt: Date;
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
  /** Customer-project hosted auth configuration. Absent on the internal landing-page demo. */
  identityDataMode?: HostedAuthIdentityDataMode;
  identifierString?: ProjectIdentifierString;
  authRealm?: string;
  rpId?: string;
  signupHostedUrl?: string;
  signinHostedUrl?: string;
  enabledMethods: VerificationType[];
  allowedOrigins: string[];
  callbackUrl?: string;
  callbackSecretEncrypted?: string;
  active: boolean;
  activatedAt: Date;
  /**
   * Customer-entered branding for `email_code` delivery emails only (see
   * `backend/packages/api/src/email-otp-service.ts`) — never used anywhere else in the
   * product. `brandLogoUrl` is a pasted link to an already-hosted image,
   * not an uploaded file (DigitalOcean Spaces isn't provisioned for
   * arbitrary customer uploads yet). `brandReplyToEmail` sets the email's
   * `replyTo` (needs no domain verification, unlike the "From" address,
   * which always stays our own verified sender). `brandHtmlTemplate`, if
   * set, replaces the auto-generated brand-name/logo template entirely —
   * the customer's own full HTML with a `{{CODE}}` placeholder.
   */
  brandName?: string;
  brandLogoUrl?: string;
  brandReplyToEmail?: string;
  brandHtmlTemplate?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerProjectDocument = ProjectDocument &
  Required<
    Pick<
      ProjectDocument,
      | "identityDataMode"
      | "identifierString"
      | "authRealm"
      | "rpId"
      | "signupHostedUrl"
      | "signinHostedUrl"
    >
  >;

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
 * `backend/packages/api/src/alerting-service.ts`) — keyed by a stable condition key
 * (e.g. `queue_backlog:verification-jobs`, `node_stale:node_abc123`) so
 * `backend/packages/api/src/alert-dispatcher.ts` doesn't re-email the admin for the
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

/**
 * Index specs are performance/integrity aids, not code the request path
 * depends on to run — a bad spec in one feature (e.g. a MongoDB operator a
 * given Atlas version rejects) must never stop the whole process from
 * booting and serving every *other* route, including completely unrelated
 * ones like the marketing site. Each step below is isolated: failures are
 * logged loudly instead of rejecting `ensureIndexes` as a whole, so the
 * server always finishes starting up.
 */
async function ensureIndexStep(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "powerotp-api",
        component: "ensure-indexes",
        msg: "index setup step failed; continuing startup",
        step: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    ensureIndexStep("users.emailLookupHash", () =>
      db.collection<UserDocument>("users").createIndex({ emailLookupHash: 1 }, { unique: true }),
    ),
    ensureIndexStep("sessions.expiresAt", () =>
      db.collection<SessionDocument>("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ),
    ensureIndexStep("sessions.userId_expiresAt", () =>
      db.collection<SessionDocument>("sessions").createIndex({ userId: 1, expiresAt: -1 }),
    ),
    ensureIndexStep("emailVerifications.expiresAt", () =>
      db
        .collection<EmailVerificationDocument>("emailVerifications")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ),
    ensureIndexStep("projects.slug", () =>
      db.collection<ProjectDocument>("projects").createIndex({ slug: 1 }, { unique: true }),
    ),
    ensureIndexStep("projects.identifierString", () =>
      db.collection<ProjectDocument>("projects").createIndex(
        { identifierString: 1 },
        { unique: true, sparse: true },
      ),
    ),
    ensureIndexStep("projects.customerId_createdAt", () =>
      db.collection<ProjectDocument>("projects").createIndex({ customerId: 1, createdAt: -1 }),
    ),
    ensureIndexStep("apiKeys.keyHash", () =>
      db.collection<ApiKeyDocument>("apiKeys").createIndex({ keyHash: 1 }, { unique: true }),
    ),
    ensureIndexStep("apiKeys.projectId_revokedAt", () =>
      db.collection<ApiKeyDocument>("apiKeys").createIndex({ projectId: 1, revokedAt: 1 }),
    ),
    ensureIndexStep("auditEvents.actorId_occurredAt", () =>
      db.collection<AuditDocument>("auditEvents").createIndex({ actorId: 1, occurredAt: -1 }),
    ),
    ensureIndexStep("nodes.ip", () =>
      db.collection<NodeDocument>("nodes").createIndex({ ip: 1 }, { unique: true }),
    ),
    ensureIndexStep("verification", () => ensureVerificationIndexes(db)),
    ensureIndexStep("challenge", () => ensureChallengeIndexes(db)),
    ensureIndexStep("modalSession", () => ensureModalSessionIndexes(db)),
    ensureIndexStep("billing", () => ensureBillingIndexes(db)),
    ensureIndexStep("accounting", () => ensureAccountingIndexes(db)),
    ensureIndexStep("botBlockerSite", () => ensureBotBlockerSiteIndexes(db)),
    ensureIndexStep("botBlockerSiteCredential", () => ensureBotBlockerSiteCredentialIndexes(db)),
    ensureIndexStep("botBlockerIntelligence", () => ensureBotBlockerIntelligenceIndexes(db)),
    ensureIndexStep("fingerprintData", () => ensureFingerprintDataIndexes(db)),
    ensureIndexStep("botBlockerIpBlacklist", () => ensureBotBlockerIpBlacklistIndexes(db)),
    ensureIndexStep("botBlockerIpApiLookup", () => ensureBotBlockerIpApiLookupIndexes(db)),
    ensureIndexStep("botBlockerNetworkRange", () => ensureBotBlockerNetworkRangeIndexes(db)),
    ensureIndexStep("botBlockerAsnClassification", () => ensureBotBlockerAsnClassificationIndexes(db)),
    ensureIndexStep("botBlockerAsnTypeScore", () => ensureBotBlockerAsnTypeScoreIndexes(db)),
    ensureIndexStep("botBlockerProfileScoring", () => ensureBotBlockerProfileScoringIndexes(db)),
    ensureIndexStep("botBlockerRiskEventScoring", () =>
      ensureBotBlockerRiskEventScoringIndexes(db)
    ),
    ensureIndexStep("botBlockerPolicy", () => ensureBotBlockerPolicyIndexes(db)),
  ]);
}
