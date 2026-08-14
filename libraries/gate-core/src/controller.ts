import {
  DecisionTimeoutMsSchema,
  type DecisionRevisionEnvelope,
  type ReportSequence,
} from "@powerotp/contracts";
import {
  validateVerifiedDecision,
  type DecisionRejectionReason,
  type DecisionVerification,
} from "./decision.js";
import { isGateTransitionAllowed, type GateState } from "./states.js";

type GateTimer = number | ReturnType<typeof setTimeout>;

export type GateEffect =
  | { type: "freeze_page" }
  | { type: "unfreeze_page" }
  | { type: "pause_observation" }
  | { type: "start_observation"; fresh: boolean }
  | { type: "start_authoritative_polling" }
  | { type: "stop_authoritative_polling" }
  | { type: "decision_rejected"; reason: DecisionRejectionReason };

export interface GateSnapshot {
  state: GateState;
  decisionPending: boolean;
  lastApplied?: ReportSequence;
  activeChallengeId?: string;
}

export interface RestoredGateSecurityState {
  state: "checking" | "otp_required";
  lastApplied: ReportSequence;
  acceptedNonces?: readonly string[];
  activeChallengeId?: string;
}

export interface AuthoritativeGateStatus {
  status: "pending" | "verified" | "unavailable";
  siteId: string;
  gateSessionId: string;
  challengeId: string;
}

export interface GateControllerOptions {
  siteId: string;
  gateSessionId: string;
  audience: string;
  decisionTimeoutMs: number;
  clockSkewMs?: number;
  /**
   * Security state restored by the trusted same-origin adapter, never raw
   * localStorage. This preserves an active OTP and ordering across reloads.
   */
  restoredSecurityState?: RestoredGateSecurityState;
  requestDecision(): Promise<unknown>;
  verifyDecision(candidate: unknown): Promise<DecisionVerification>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => GateTimer;
  clearTimer?: (timer: GateTimer) => void;
  onStateChange?: (snapshot: GateSnapshot, previous: GateState) => void;
  onEffect?: (effect: GateEffect) => void;
}

export interface GateController {
  start(): void;
  applyDecisionRevision(candidate: unknown): Promise<boolean>;
  bindActiveChallenge(challengeId: string): boolean;
  applyAuthoritativeStatus(status: AuthoritativeGateStatus): boolean;
  resumeObservation(): boolean;
  getSnapshot(): GateSnapshot;
  dispose(): void;
}

export function createGateController(options: GateControllerOptions): GateController {
  const decisionTimeoutMs = DecisionTimeoutMsSchema.parse(options.decisionTimeoutMs);
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const clockSkewMs = options.clockSkewMs ?? 300_000;
  if (!Number.isInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 300_000) {
    throw new Error("Decision clock skew must be an integer from 0 through 300000ms");
  }
  const restored = options.restoredSecurityState;
  if (restored && restored.lastApplied.gateSessionId !== options.gateSessionId) {
    throw new Error("Restored decision state belongs to a different gate session");
  }
  if (restored?.state === "otp_required" && !isValidChallengeId(restored.activeChallengeId)) {
    throw new Error("Restored OTP state requires a valid active challenge ID");
  }
  const acceptedNonces = new Set(restored?.acceptedNonces ?? []);

  let state: GateState = restored?.state ?? "checking";
  let decisionPending = false;
  let lastApplied: ReportSequence | undefined = restored?.lastApplied;
  let activeChallengeId = restored?.activeChallengeId;
  let timeout: GateTimer | undefined;
  let started = false;
  let disposed = false;

  const snapshot = (): GateSnapshot => ({
    state,
    decisionPending,
    ...(lastApplied ? { lastApplied } : {}),
    ...(activeChallengeId ? { activeChallengeId } : {}),
  });

  const effect = (value: GateEffect) => options.onEffect?.(value);

  const transition = (next: GateState): boolean => {
    if (disposed || state === next) return false;
    if (!isGateTransitionAllowed(state, next)) return false;
    const previous = state;
    state = next;
    options.onStateChange?.(snapshot(), previous);
    return true;
  };

  const reject = (reason: DecisionRejectionReason): false => {
    effect({ type: "decision_rejected", reason });
    return false;
  };

  const markUnavailable = (): void => {
    if (state !== "checking" && state !== "optimistic_allow") return;
    if (transition("unavailable")) effect({ type: "start_observation", fresh: false });
  };

  const applyVerified = (decision: DecisionRevisionEnvelope): boolean => {
    if (state === "otp_required" && decision.outcome === "allow") {
      return reject("challenge_active");
    }

    acceptedNonces.add(decision.nonce);
    lastApplied = decision.sequence;

    if (decision.outcome === "otp") {
      if (state === "otp_required") return true;
      if (!transition("otp_required")) return false;
      effect({ type: "pause_observation" });
      effect({ type: "freeze_page" });
      effect({ type: "start_authoritative_polling" });
      return true;
    }

    const fresh = state === "verified";
    if (!transition("observing")) return false;
    effect({ type: "start_observation", fresh });
    return true;
  };

  const verifyAndApply = async (candidate: unknown): Promise<boolean> => {
    let verification: DecisionVerification;
    try {
      verification = await options.verifyDecision(candidate);
    } catch {
      return reject("unverified");
    }
    if (disposed) return false;

    const validated = validateVerifiedDecision(verification, {
      siteId: options.siteId,
      gateSessionId: options.gateSessionId,
      audience: options.audience,
      now: now(),
      clockSkewMs,
      lastApplied,
      acceptedNonces,
    });
    if (!validated.accepted) return reject(validated.reason);
    return applyVerified(validated.decision);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      if (state === "otp_required") {
        effect({ type: "pause_observation" });
        effect({ type: "freeze_page" });
        effect({ type: "start_authoritative_polling" });
        return;
      }
      decisionPending = true;
      timeout = setTimer(() => {
        timeout = undefined;
        if (state === "checking" && transition("optimistic_allow")) {
          effect({ type: "start_observation", fresh: false });
        }
      }, decisionTimeoutMs);

      void options.requestDecision().then(
        async (candidate) => {
          decisionPending = false;
          await verifyAndApply(candidate);
        },
        () => {
          decisionPending = false;
          markUnavailable();
        },
      );
    },

    applyDecisionRevision(candidate) {
      return verifyAndApply(candidate);
    },

    bindActiveChallenge(challengeId) {
      if (
        state !== "otp_required" ||
        !isValidChallengeId(challengeId) ||
        (activeChallengeId !== undefined && activeChallengeId !== challengeId)
      ) {
        return false;
      }
      activeChallengeId = challengeId;
      return true;
    },

    applyAuthoritativeStatus(status) {
      if (
        state !== "otp_required" ||
        status.status !== "verified" ||
        !activeChallengeId ||
        status.siteId !== options.siteId ||
        status.gateSessionId !== options.gateSessionId ||
        status.challengeId !== activeChallengeId
      ) {
        return false;
      }
      if (!transition("verified")) return false;
      effect({ type: "stop_authoritative_polling" });
      effect({ type: "unfreeze_page" });
      return true;
    },

    resumeObservation() {
      if (state !== "verified" || !transition("observing")) return false;
      effect({ type: "start_observation", fresh: true });
      return true;
    },

    getSnapshot: snapshot,

    dispose() {
      disposed = true;
      if (timeout !== undefined) clearTimer(timeout);
      timeout = undefined;
    },
  };
}

function isValidChallengeId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 200;
}
