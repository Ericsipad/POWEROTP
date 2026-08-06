/**
 * Q.850 hangup causes Asterisk reports on `ChannelDestroyed`, mapped to the
 * small, stable reason-code vocabulary the dashboard/callbacks use. See
 * `docs/MVP_ACCEPTANCE.md` Type 1: "Answered, busy, no-answer, rejected,
 * invalid, canceled, and timeout calls map consistently." Shared by every
 * call-control flow (reachability, voice code, ...) since a call that never
 * answers fails the same way regardless of what it was trying to do once
 * answered.
 */
const causeReasonCode: Record<number, string> = {
  1: "invalid_number", // Unallocated number
  17: "busy", // User busy
  18: "no_answer", // No user responding
  19: "no_answer", // No answer from user (alerted)
  21: "call_rejected", // Call rejected
  27: "invalid_number", // Destination out of order
  28: "invalid_number", // Invalid number format
  34: "provider_unavailable", // No circuit/channel available
  38: "provider_unavailable", // Network out of order
};

export function reasonCodeForHangupCause(cause: number | undefined): string {
  return causeReasonCode[cause ?? -1] ?? "call_failed";
}
