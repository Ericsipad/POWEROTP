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
  createFingerprintCollector,
  type FingerprintCollector,
  type FingerprintCollectorOptions,
} from "./fingerprint-collector.js";
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
  createContinuousBrowserSensor,
  type ContinuousBrowserSensor,
  type ContinuousBrowserSensorOptions,
} from "./sensor.js";
export {
  createSensorEvidenceAccumulator,
  sanitizeRoutePath,
  type SensorEvidenceAccumulator,
  type SensorEvidenceOptions,
} from "./sensor-evidence.js";
export {
  pageDimensions,
  type PageDimensions,
} from "./sensor-analytics.js";
export {
  gateStates,
  isGateObservationPaused,
  isGatePageOpen,
  isGateTransitionAllowed,
  type GateState,
} from "./states.js";
