import type { VerificationState, VerificationType } from "@powerotp/contracts";

export const initialVerificationState: VerificationState = "queued";

export const terminalVerificationStateSet = new Set<VerificationState>([
  "succeeded",
  "failed",
  "expired",
  "canceled",
]);

/**
 * Each verification type only visits the states that apply to it. States are
 * listed in the order they must occur; terminal states are reachable as an
 * interrupt from any non-terminal active state and are validated separately.
 */
const activeStatesByType: Record<VerificationType, readonly VerificationState[]> = {
  call_reachability: ["queued", "dispatching", "calling", "ringing", "answered"],
  voice_code: [
    "queued",
    "dispatching",
    "calling",
    "ringing",
    "answered",
    "playing",
    "awaiting_response",
  ],
  voice_challenge: [
    "queued",
    "dispatching",
    "calling",
    "ringing",
    "answered",
    "playing",
    "awaiting_response",
  ],
  sms_code: ["queued", "dispatching", "awaiting_response"],
};

export function activeStatesFor(type: VerificationType): readonly VerificationState[] {
  return activeStatesByType[type];
}

export function isTerminalState(state: VerificationState) {
  return terminalVerificationStateSet.has(state);
}

/**
 * A transition is allowed when either:
 * - the target is a terminal state and the current state is not already
 *   terminal (any active state can be interrupted by a result), or
 * - the target is the immediate next active state after the current one for
 *   this verification type (strict forward progress, no skipping or
 *   repeating).
 */
export function isTransitionAllowed(
  type: VerificationType,
  from: VerificationState,
  to: VerificationState,
): boolean {
  if (isTerminalState(from)) return false;
  if (isTerminalState(to)) return true;

  const activeStates = activeStatesByType[type];
  const fromIndex = activeStates.indexOf(from);
  const toIndex = activeStates.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

/**
 * The next active state in sequence for a type, or undefined once the
 * final active state (awaiting a result) has been reached.
 */
export function nextActiveState(
  type: VerificationType,
  from: VerificationState,
): VerificationState | undefined {
  const activeStates = activeStatesByType[type];
  const fromIndex = activeStates.indexOf(from);
  if (fromIndex === -1) return undefined;
  return activeStates[fromIndex + 1];
}
