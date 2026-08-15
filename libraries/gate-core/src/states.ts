export const gateStates = [
  "checking",
  "optimistic_allow",
  "observing",
  "otp_required",
  "verified",
  "unavailable",
] as const;

export type GateState = (typeof gateStates)[number];

const allowedTransitions: Readonly<Record<GateState, readonly GateState[]>> = {
  checking: ["optimistic_allow", "observing", "otp_required", "unavailable"],
  optimistic_allow: ["observing", "otp_required", "unavailable"],
  observing: ["otp_required"],
  otp_required: ["verified"],
  verified: ["observing", "otp_required"],
  unavailable: ["observing", "otp_required"],
};

export function isGateTransitionAllowed(from: GateState, to: GateState): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

export function isGatePageOpen(_state: GateState, otpOpen = false): boolean {
  return !otpOpen;
}

export function isGateObservationPaused(_state: GateState, otpOpen = false): boolean {
  return otpOpen;
}
