import type { VerificationState, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { InteractionChallenge } from "./challenge-service.js";

/**
 * The provider's own record of a call/SMS event, pulled minutes after the
 * interaction's own delivery attempt finishes (see
 * `apps/api/src/provider-reconcile-service.ts`) — deliberately kept
 * separate from the state-machine-driven fields above, and never blocks or
 * delays anything customer-facing. `raw` is the full, unmodified API
 * response row as VoIP.ms returned it (field names are not fully
 * documented publicly, so keeping the whole row means nothing is lost if
 * the known-field extraction below needs adjusting later); `durationSeconds`/
 * `providerCostUsd` are this project's best-effort extraction from it.
 * There is deliberately no "customer cost" field yet — the balance-tiered
 * pricing rule that turns this into what a customer is actually charged
 * has not been specified; see `docs/AS_BUILT.md`'s "Provider cost
 * reconciliation" section.
 */
export interface ProviderRecordSnapshot {
  source: "voipms_cdr" | "voipms_sms";
  fetchedAt: Date;
  durationSeconds?: number;
  providerCostUsd?: number;
  raw: Record<string, unknown>;
}

export interface VerificationRequestDocument {
  _id: string;
  projectId: string;
  customerId: string;
  type: VerificationType;
  targetNumber: string;
  state: VerificationState;
  reasonCode?: string;
  sequence: number;
  correlationId: string;
  browserResponse: boolean;
  /**
   * Authenticated-encrypted with `CONFIG_ENCRYPTION_KEY` (same primitive as
   * `ProjectDocument#callbackSecretEncrypted`), never plaintext — a
   * five-digit code is short enough that a plaintext leak (logs, a DB
   * snapshot, etc.) would be trivially guessable/replayable. Decrypted only
   * transiently: once to compare against a submitted code, and once at
   * the delivery boundary (telephony node or SMS provider adapter).
   */
  expectedCodeEncrypted?: string;
  /**
   * A `voice_challenge` interaction's per-interaction snapshot, bound once
   * at `create()` (see `ChallengeService#selectAndMaterialize`) — never
   * re-derived from the mutable challenge catalog, so retiring a challenge
   * can never break an interaction already in flight.
   */
  challenge?: InteractionChallenge;
  interactionTokenNonce?: string;
  interactionTokenConsumedAt?: Date;
  /**
   * Which trunk (`trunk-1`, `trunk-2`, ...) actually placed/decided this
   * call, for the three voice types — set from the telephony node's final
   * job-event report (`NodeJobEventSchema#trunkId`) so a later
   * reconciliation pass knows which VoIP.ms subaccount to query for the
   * real CDR. Unset for `sms_code`, and unset entirely if dispatch never
   * reached a node at all (e.g. `method_not_available`).
   */
  callTrunkId?: string;
  /**
   * Which `TRUNKn_DID` actually sent this `sms_code` message — set right
   * before the `awaiting_response` transition once `sms.ts` confirms the
   * provider accepted the send (never set on a rejected/failed send,
   * since that DID was never actually used/billed).
   */
  smsDid?: string;
  /** See `ProviderRecordSnapshot` above. */
  providerRecord?: ProviderRecordSnapshot;
  /**
   * `"pending"` once reconciliation has been scheduled, `"matched"` once
   * `providerRecord` is populated, `"not_found"` if VoIP.ms's own records
   * never produced a match after every retry, `"error"` if the lookup
   * itself kept failing (bad credentials, VoIP.ms outage, etc.) — distinct
   * from `"not_found"` so the two failure modes aren't confused later.
   * Absent entirely for interactions that never reached a real provider
   * attempt (nothing to reconcile).
   */
  providerRecordStatus?: "pending" | "matched" | "not_found" | "error";
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface VerificationEventDocument {
  _id: string;
  interactionId: string;
  projectId: string;
  sequence: number;
  type: VerificationType;
  state: VerificationState;
  reasonCode?: string;
  occurredAt: Date;
}

export interface IdempotencyRecordDocument {
  _id: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  interactionId: string;
  createdAt: Date;
}

export interface CallbackDeliveryDocument {
  _id: string;
  interactionId: string;
  eventId: string;
  projectId: string;
  attempt: number;
  status: "delivered" | "failed";
  statusCode?: number;
  error?: string;
  occurredAt: Date;
}

export function idempotencyRecordId(projectId: string, idempotencyKey: string) {
  return `${projectId}:${idempotencyKey}`;
}

/**
 * Retention policy for `verificationRequests`/`verificationEvents`/
 * `callbackDeliveries` (see `docs/AS_BUILT.md`'s "Data retention" section):
 * the user was explicit these records must never be manually/eagerly
 * deleted (they're the platform's one source of truth for every
 * transaction, report, and provider-cost figure) — but 18 months after
 * creation, MongoDB's own TTL background task removes them automatically,
 * the same mechanism already used for `sessions`/`emailVerifications`/
 * `idempotencyRecords` above. 18 months ~= 547.5 days; rounded up to 548
 * so nothing is ever removed a day early. A future session may add a
 * pre-expiry export to cold storage (the user mentioned Wasabi) once
 * that's actually needed — deliberately not built yet, since nothing is
 * close to the 18-month mark today.
 */
export const RETENTION_PERIOD_SECONDS = 548 * 24 * 60 * 60;

export async function ensureVerificationIndexes(db: Db) {
  await Promise.all([
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ projectId: 1, createdAt: -1 }),
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ state: 1, expiresAt: 1 }),
    // Supports claimNextForNode's per-type claim query at scale — without
    // this, a node polling for one type scans every document in any active
    // state.
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ type: 1, state: 1, createdAt: 1 }),
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: RETENTION_PERIOD_SECONDS }),
    db
      .collection<VerificationEventDocument>("verificationEvents")
      .createIndex({ interactionId: 1, sequence: 1 }, { unique: true }),
    db
      .collection<VerificationEventDocument>("verificationEvents")
      .createIndex({ occurredAt: 1 }, { expireAfterSeconds: RETENTION_PERIOD_SECONDS }),
    db
      .collection<IdempotencyRecordDocument>("idempotencyRecords")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }),
    db
      .collection<CallbackDeliveryDocument>("callbackDeliveries")
      .createIndex({ interactionId: 1, occurredAt: -1 }),
    db
      .collection<CallbackDeliveryDocument>("callbackDeliveries")
      .createIndex({ occurredAt: 1 }, { expireAfterSeconds: RETENTION_PERIOD_SECONDS }),
  ]);
}
