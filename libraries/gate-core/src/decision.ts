import {
  DecisionRevisionEnvelopeSchema,
  isStaleSequence,
  type DecisionRevisionEnvelope,
  type ReportSequence,
} from "@powerotp/contracts/browser";

export type DecisionRejectionReason =
  | "unverified"
  | "malformed"
  | "expired"
  | "future_issued"
  | "wrong_site"
  | "wrong_session"
  | "wrong_audience"
  | "stale"
  | "replay"
  | "challenge_active";

export type DecisionVerification =
  | { verified: true; decision: unknown }
  | { verified: false; reason?: string };

export interface DecisionValidationContext {
  siteId: string;
  gateSessionId: string;
  audience: string;
  now: number;
  clockSkewMs?: number;
  lastApplied?: ReportSequence;
  acceptedNonces: ReadonlySet<string>;
}

export type ValidatedDecision =
  | { accepted: true; decision: DecisionRevisionEnvelope }
  | { accepted: false; reason: DecisionRejectionReason };

/**
 * Trust is established outside the browser state machine. The verifier port
 * must return `verified: true` only for an authentic signed server artifact.
 * This function then applies the browser's strict binding and replay guards.
 */
export function validateVerifiedDecision(
  verification: DecisionVerification,
  context: DecisionValidationContext,
): ValidatedDecision {
  if (!verification.verified) return { accepted: false, reason: "unverified" };

  const parsed = DecisionRevisionEnvelopeSchema.safeParse(verification.decision);
  if (!parsed.success) return { accepted: false, reason: "malformed" };

  const decision = parsed.data;
  if (decision.siteId !== context.siteId) return { accepted: false, reason: "wrong_site" };
  if (decision.sequence.gateSessionId !== context.gateSessionId) {
    return { accepted: false, reason: "wrong_session" };
  }
  if (decision.audience !== context.audience) {
    return { accepted: false, reason: "wrong_audience" };
  }
  if (decision.expiresAt <= context.now) return { accepted: false, reason: "expired" };
  if (decision.sequence.issuedAt > context.now + (context.clockSkewMs ?? 300_000)) {
    return { accepted: false, reason: "future_issued" };
  }
  if (isStaleSequence(decision.sequence, context.lastApplied)) {
    return { accepted: false, reason: "stale" };
  }
  if (context.acceptedNonces.has(decision.nonce)) {
    return { accepted: false, reason: "replay" };
  }

  return { accepted: true, decision };
}
