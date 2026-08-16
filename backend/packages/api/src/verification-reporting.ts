import type {
  CallbackDeliverySummary,
  InteractionSummary,
  VerificationState,
  VerificationType,
  WidgetInteractionSummary,
} from "@powerotp/contracts";
import type { Collection, Filter } from "mongodb";

import type { CallbackDeliveryDocument } from "./verification-persistence.js";
import { maskTarget } from "./masking.js";
import { isTerminalState } from "./verification-state-machine.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";

const emptyByType: Record<VerificationType, number> = {
  call_reachability: 0,
  voice_code: 0,
  voice_challenge: 0,
  sms_code: 0,
  email_code: 0,
};

async function aggregateStats(
  requests: Collection<VerificationRequestDocument>,
  match: Filter<VerificationRequestDocument>,
) {
  const rows = await requests
    .aggregate<{ _id: { type: VerificationType; state: VerificationState }; count: number }>([
      { $match: match },
      { $group: { _id: { type: "$type", state: "$state" }, count: { $sum: 1 } } },
    ])
    .toArray();

  const byType = { ...emptyByType };
  let total = 0;
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    total += row.count;
    byType[row._id.type] += row.count;
    if (row._id.state === "succeeded") succeeded += row.count;
    if (row._id.state === "failed" || row._id.state === "expired") failed += row.count;
  }
  return { total, succeeded, failed, byType };
}

export async function computeProjectStats(
  requests: Collection<VerificationRequestDocument>,
  projectId: string,
) {
  return aggregateStats(requests, { projectId });
}

/**
 * Same shape as `computeProjectStats`, aggregated across every project —
 * backs the admin "Platform usage" panel (see `docs/AS_BUILT.md`'s "Admin
 * operator health dashboard" section). Deliberately platform-wide totals
 * only, no per-day/per-hour breakdown, matching this project's existing
 * manual-refresh-snapshot pattern rather than adding charts/history.
 */
export async function computePlatformStats(requests: Collection<VerificationRequestDocument>) {
  return aggregateStats(requests, {});
}

/**
 * Total vs. failed/expired interaction counts created within the last
 * `windowMs` — the raw input the platform alerting job (see
 * `backend/packages/api/src/alerting-service.ts#evaluateFailureRate`) decides a
 * high-failure-rate alert from. Kept as a thin aggregate here, not inside
 * the alerting module, so the alerting logic itself stays pure/unit-testable
 * without a live Mongo collection.
 */
export async function countRecentOutcomes(
  requests: Collection<VerificationRequestDocument>,
  windowMs: number,
): Promise<{ total: number; failed: number }> {
  const since = new Date(Date.now() - windowMs);
  const rows = await requests
    .aggregate<{ _id: VerificationState; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$state", count: { $sum: 1 } } },
    ])
    .toArray();
  let total = 0;
  let failed = 0;
  for (const row of rows) {
    total += row.count;
    if (row._id === "failed" || row._id === "expired") failed += row.count;
  }
  return { total, failed };
}

/**
 * Recent callback delivery attempts, most recent first — the data itself
 * (`callbackDeliveries`) was already recorded by `backend/packages/api/src/callback-worker.ts`
 * on every attempt; this just makes it visible for diagnostics instead of
 * requiring a direct Mongo query.
 */
export async function listRecentCallbackDeliveries(
  deliveries: Collection<CallbackDeliveryDocument>,
  limit = 50,
): Promise<CallbackDeliverySummary[]> {
  const rows = await deliveries.find().sort({ occurredAt: -1 }).limit(limit).toArray();
  return rows.map((row) => ({
    id: row._id,
    interactionId: row.interactionId,
    eventId: row.eventId,
    projectId: row.projectId,
    attempt: row.attempt,
    status: row.status,
    statusCode: row.statusCode,
    error: row.error,
    occurredAt: row.occurredAt.toISOString(),
  }));
}

/**
 * Recent real end-user widget interactions, most recent first — filtered
 * to verifications that actually have `endUserIp` set, i.e. only ones
 * created through the hosted modal's own
 * `POST /v1/modal-sessions/{sessionId}/verifications` route, never a
 * customer-backend-created one (which has no meaningful end-user IP to
 * show). Visibility/audit only, no fraud/risk logic attached to this yet.
 */
export async function listRecentWidgetInteractions(
  requests: Collection<VerificationRequestDocument>,
  limit = 50,
): Promise<WidgetInteractionSummary[]> {
  const rows = await requests
    .find({ endUserIp: { $exists: true } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => ({
    interactionId: row._id,
    occurredAt: row.createdAt.toISOString(),
    type: row.type,
    state: row.state,
    maskedTarget: maskTarget(row.type, row.targetNumber),
    endUserIp: row.endUserIp,
    endUserUserAgent: row.endUserUserAgent,
  }));
}

/**
 * Same shape and filter as `listRecentWidgetInteractions` above (real
 * end-user widget interactions only, i.e. `endUserIp` is set), scoped to
 * one project — backs the customer dashboard's own "Visitors" tab (see
 * `docs/AS_BUILT.md`'s "Customer signup flow"/dashboard section). Ownership
 * of `projectId` is the caller's responsibility (see
 * `ProjectService#assertOwned`), same convention as every other
 * project-scoped route.
 */
export async function listProjectWidgetInteractions(
  requests: Collection<VerificationRequestDocument>,
  projectId: string,
  limit = 50,
): Promise<WidgetInteractionSummary[]> {
  const rows = await requests
    .find({ projectId, endUserIp: { $exists: true } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => ({
    interactionId: row._id,
    occurredAt: row.createdAt.toISOString(),
    type: row.type,
    state: row.state,
    maskedTarget: maskTarget(row.type, row.targetNumber),
    endUserIp: row.endUserIp,
    endUserUserAgent: row.endUserUserAgent,
  }));
}

export async function listProjectInteractions(
  requests: Collection<VerificationRequestDocument>,
  projectId: string,
  limit = 50,
  type?: VerificationType,
): Promise<InteractionSummary[]> {
  const rows = await requests
    .find(type ? { projectId, type } : { projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => ({
    interactionId: row._id,
    occurredAt: row.updatedAt.toISOString(),
    type: row.type,
    state: row.state,
    maskedTarget: maskTarget(row.type, row.targetNumber),
    durationMs: isTerminalState(row.state)
      ? row.updatedAt.getTime() - row.createdAt.getTime()
      : undefined,
    correlationId: row.correlationId,
  }));
}
