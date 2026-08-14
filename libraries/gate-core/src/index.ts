export {
  createGateController,
  type AuthoritativeGateStatus,
  type GateController,
  type GateControllerOptions,
  type GateEffect,
  type GateSnapshot,
  type RestoredGateSecurityState,
} from "./controller.js";
export {
  validateVerifiedDecision,
  type DecisionRejectionReason,
  type DecisionValidationContext,
  type DecisionVerification,
  type ValidatedDecision,
} from "./decision.js";
export {
  createPageLock,
  type PageLock,
  type PageLockOptions,
} from "./page-lock.js";
export {
  createAuthoritativePoller,
  type AuthoritativePoller,
  type AuthoritativePollerOptions,
  type AuthoritativeVerificationStatus,
} from "./polling.js";
export {
  createChallengeMessageHandler,
  type ChallengeMessageGuardOptions,
  type ChallengeUxMessage,
} from "./post-message.js";
export {
  resolveSafeReturn,
  type SafeReturnOptions,
} from "./safe-return.js";
export {
  gateStates,
  isGateObservationPaused,
  isGatePageOpen,
  isGateTransitionAllowed,
  type GateState,
} from "./states.js";
