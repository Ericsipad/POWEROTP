import {
  GateRecommendationSnapshotSchema,
  type GateRecommendationSnapshot,
  type ReportSequence,
} from "@powerotp/contracts";

import type { GateSession, ProtectedRequestState } from "./types.js";

export function checkingSnapshot(
  decisionPending: boolean,
  lastApplied?: ReportSequence,
): GateRecommendationSnapshot {
  return parse({
    lifecycle: "checking",
    recommendation: "restricted",
    decisionPending,
    otpOpen: false,
    ...(lastApplied ? { lastApplied } : {}),
  });
}

export function failOpenSnapshot(
  decisionPending: boolean,
  lastApplied?: ReportSequence,
): GateRecommendationSnapshot {
  return parse({
    lifecycle: "fail_open",
    recommendation: "full_access",
    decisionPending,
    otpOpen: false,
    ...(lastApplied ? { lastApplied } : {}),
  });
}

export function unavailableSnapshot(lastApplied?: ReportSequence): GateRecommendationSnapshot {
  return parse({
    lifecycle: "unavailable",
    recommendation: "full_access",
    decisionPending: false,
    otpOpen: false,
    ...(lastApplied ? { lastApplied } : {}),
  });
}

export function allowSnapshot(lastApplied?: ReportSequence): GateRecommendationSnapshot {
  return parse({
    lifecycle: "observing",
    recommendation: "full_access",
    decision: "allow",
    decisionPending: false,
    otpOpen: false,
    ...(lastApplied ? { lastApplied } : {}),
  });
}

export function otpSnapshot(
  lastApplied: ReportSequence,
  otpOpen = false,
): GateRecommendationSnapshot {
  return parse({
    lifecycle: "otp_required",
    recommendation: "otp_required",
    decision: "otp",
    decisionPending: false,
    otpOpen,
    lastApplied,
  });
}

export function verifiedSnapshot(lastApplied?: ReportSequence): GateRecommendationSnapshot {
  return parse({
    lifecycle: "verified",
    recommendation: "full_access",
    decision: "otp",
    decisionPending: false,
    otpOpen: false,
    ...(lastApplied ? { lastApplied } : {}),
  });
}

export function protectedState(session: GateSession): ProtectedRequestState {
  const recommendation = session.recommendation ?? checkingSnapshot(false, session.lastApplied);
  return {
    protected: true,
    access: accessFor(session, recommendation),
    sessionId: session.id,
    recommendation,
  };
}

export function retainsActiveOtp(session: GateSession): boolean {
  return (
    session.activeChallenge !== undefined ||
    session.recommendation?.lifecycle === "otp_required"
  );
}

function accessFor(
  session: GateSession,
  snapshot: GateRecommendationSnapshot,
): Extract<ProtectedRequestState, { protected: true }>["access"] {
  if (snapshot.lifecycle === "checking") return "checking";
  if (snapshot.lifecycle === "fail_open") return "fail_open";
  if (snapshot.lifecycle === "unavailable") return "unavailable";
  if (snapshot.lifecycle === "otp_required") return "otp";
  if (session.clearanceVerified) return "clearance";
  return "allow";
}

function parse(value: unknown): GateRecommendationSnapshot {
  return GateRecommendationSnapshotSchema.parse(value);
}
