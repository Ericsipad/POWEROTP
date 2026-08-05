import type {
  InteractionSummary,
  VerificationState,
  VerificationType,
} from "@powerotp/contracts";
import type { Collection } from "mongodb";

import { maskE164 } from "./masking.js";
import { isTerminalState } from "./verification-state-machine.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";

const emptyByType: Record<VerificationType, number> = {
  call_reachability: 0,
  voice_code: 0,
  voice_challenge: 0,
  sms_code: 0,
};

export async function computeProjectStats(
  requests: Collection<VerificationRequestDocument>,
  projectId: string,
) {
  const rows = await requests
    .aggregate<{ _id: { type: VerificationType; state: VerificationState }; count: number }>([
      { $match: { projectId } },
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

export async function listProjectInteractions(
  requests: Collection<VerificationRequestDocument>,
  projectId: string,
  limit = 50,
): Promise<InteractionSummary[]> {
  const rows = await requests
    .find({ projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => ({
    interactionId: row._id,
    occurredAt: row.updatedAt.toISOString(),
    type: row.type,
    state: row.state,
    maskedTarget: maskE164(row.targetNumber),
    durationMs: isTerminalState(row.state)
      ? row.updatedAt.getTime() - row.createdAt.getTime()
      : undefined,
    correlationId: row.correlationId,
  }));
}
