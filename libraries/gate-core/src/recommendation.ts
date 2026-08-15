import {
  GateRecommendationSnapshotSchema,
  type BotBlockerDecisionOutcome,
  type GateRecommendationSnapshot,
  type ReportSequence,
} from "@powerotp/contracts";

import type { GateState } from "./states.js";

export interface GateRecommendationInput {
  state: GateState;
  decision?: BotBlockerDecisionOutcome;
  decisionPending: boolean;
  otpOpen: boolean;
  lastApplied?: ReportSequence;
}

/** Maps private controller lifecycle into the closed advisory browser contract. */
export function createGateSnapshot(input: GateRecommendationInput): GateRecommendationSnapshot {
  const common = {
    decisionPending: input.decisionPending,
    otpOpen: false as const,
    ...(input.lastApplied ? { lastApplied: input.lastApplied } : {}),
  };
  if (input.state === "checking") {
    return GateRecommendationSnapshotSchema.parse({
      ...common,
      lifecycle: "checking",
      recommendation: "restricted",
    });
  }
  if (input.state === "optimistic_allow") {
    return GateRecommendationSnapshotSchema.parse({
      ...common,
      lifecycle: "fail_open",
      recommendation: "full_access",
    });
  }
  if (input.state === "unavailable") {
    return GateRecommendationSnapshotSchema.parse({
      ...common,
      lifecycle: "unavailable",
      recommendation: "full_access",
    });
  }
  if (input.state === "otp_required") {
    return GateRecommendationSnapshotSchema.parse({
      ...common,
      lifecycle: "otp_required",
      recommendation: "otp_required",
      decision: "otp",
      otpOpen: input.otpOpen,
    });
  }
  if (input.state === "verified" || input.decision === "otp") {
    return GateRecommendationSnapshotSchema.parse({
      ...common,
      lifecycle: "verified",
      recommendation: "full_access",
      decision: "otp",
    });
  }
  return GateRecommendationSnapshotSchema.parse({
    ...common,
    lifecycle: "observing",
    recommendation: "full_access",
    decision: "allow",
  });
}
