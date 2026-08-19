import {
  DecisionTimeoutMsSchema,
  OtpLaunchMetadataSchema,
  type DecisionRevisionEnvelope,
  type GateRecommendationSnapshot,
  type ReportSequence,
} from "@powerotp/contracts/browser";
import {
  validateVerifiedDecision,
  type DecisionRejectionReason,
  type DecisionVerification,
} from "./decision.js";
import { createGateSnapshot } from "./recommendation.js";
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

export type GateSnapshot = GateRecommendationSnapshot;

interface RestoredGateSecurityBase {
  acceptedNonces?: readonly string[];
}

export type RestoredGateSecurityState = RestoredGateSecurityBase & (
  | {
      state: "checking";
      lastApplied: ReportSequence;
    }
  | {
      state: "observing";
      decision: "allow";
      lastApplied?: ReportSequence;
    }
  | {
      state: "otp_required";
      decision?: "otp";
      lastApplied: ReportSequence;
      activeChallengeId: string;
    }
);

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
  launchOtp?(): Promise<unknown>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => GateTimer;
  clearTimer?: (timer: GateTimer) => void;
  onStateChange?: (snapshot: GateSnapshot, previous: GateState) => void;
  onEffect?: (effect: GateEffect) => void;
}

export interface GateController {
  start(): void;
  applyDecisionRevision(candidate: unknown): Promise<boolean>;
  openOtp(): Promise<boolean>;
  applyAuthoritativeStatus(status: AuthoritativeGateStatus): boolean;
  resumeObservation(): boolean;
  getSnapshot(): GateSnapshot;
  subscribe(listener: () => void): () => void;
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
  if (restored?.lastApplied && restored.lastApplied.gateSessionId !== options.gateSessionId) {
    throw new Error("Restored decision state belongs to a different gate session");
  }
  if (restored?.state === "otp_required" && !isValidChallengeId(restored.activeChallengeId)) {
    throw new Error("Restored OTP state requires a valid active challenge ID");
  }
  const acceptedNonces = new Set(restored?.acceptedNonces ?? []);

  let state: GateState = restored?.state ?? "checking";
  let decisionPending = false;
  let lastApplied: ReportSequence | undefined = restored?.lastApplied;
  let activeChallengeId =
    restored?.state === "otp_required" ? restored.activeChallengeId : undefined;
  let decision: DecisionRevisionEnvelope["outcome"] | undefined =
    restored?.state === "observing" ? "allow" :
    restored?.state === "otp_required" ? "otp" :
    undefined;
  let otpOpen = false;
  let openingOtp = false;
  let observationResumed = false;
  let timeout: GateTimer | undefined;
  let started = false;
  let disposed = false;

  const listeners = new Set<() => void>();
  const buildSnapshot = (): GateSnapshot => createGateSnapshot({
    state,
    ...(decision ? { decision } : {}),
    decisionPending,
    otpOpen,
    ...(lastApplied ? { lastApplied } : {}),
  });
  let currentSnapshot = buildSnapshot();
  const publish = (previous: GateState) => {
    currentSnapshot = buildSnapshot();
    options.onStateChange?.(currentSnapshot, previous);
    for (const listener of listeners) listener();
  };

  const effect = (value: GateEffect) => options.onEffect?.(value);

  const transition = (next: GateState): boolean => {
    if (disposed || state === next) return false;
    if (!isGateTransitionAllowed(state, next)) return false;
    const previous = state;
    state = next;
    publish(previous);
    return true;
  };

  const reject = (reason: DecisionRejectionReason): false => {
    effect({ type: "decision_rejected", reason });
    return false;
  };

  const markUnavailable = (): boolean => {
    if (state !== "checking" && state !== "optimistic_allow") return false;
    if (!transition("unavailable")) return false;
    effect({ type: "start_observation", fresh: false });
    return true;
  };

  const applyVerified = (verifiedDecision: DecisionRevisionEnvelope): boolean => {
    if (state === "otp_required" && verifiedDecision.outcome === "allow") {
      return reject("challenge_active");
    }

    acceptedNonces.add(verifiedDecision.nonce);
    lastApplied = verifiedDecision.sequence;
    decision = verifiedDecision.outcome;

    if (verifiedDecision.outcome === "otp") {
      if (state === "otp_required") {
        publish(state);
        return true;
      }
      if (!transition("otp_required")) return false;
      return true;
    }

    const fresh = state === "verified";
    if (state === "observing") {
      publish(state);
      return true;
    }
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
        return;
      }
      if (state === "observing") {
        effect({ type: "start_observation", fresh: false });
        return;
      }
      decisionPending = true;
      publish(state);
      timeout = setTimer(() => {
        timeout = undefined;
        if (state === "checking" && transition("optimistic_allow")) {
          effect({ type: "start_observation", fresh: false });
        }
      }, decisionTimeoutMs);

      void options.requestDecision().then(
        async (candidate) => {
          decisionPending = false;
          if (!(await verifyAndApply(candidate))) publish(state);
        },
        () => {
          decisionPending = false;
          if (!markUnavailable()) publish(state);
        },
      );
    },

    applyDecisionRevision(candidate) {
      return verifyAndApply(candidate);
    },

    async openOtp() {
      if (
        disposed ||
        openingOtp ||
        otpOpen ||
        state !== "otp_required" ||
        decision !== "otp" ||
        !options.launchOtp
      ) {
        return false;
      }
      openingOtp = true;
      try {
        const launch = OtpLaunchMetadataSchema.safeParse(await options.launchOtp());
        if (!launch.success || !isValidChallengeId(launch.data.challengeId)) return false;
        activeChallengeId = launch.data.challengeId;
        otpOpen = true;
        observationResumed = false;
        publish(state);
        effect({ type: "pause_observation" });
        effect({ type: "freeze_page" });
        effect({ type: "start_authoritative_polling" });
        return true;
      } catch {
        return false;
      } finally {
        openingOtp = false;
      }
    },

    applyAuthoritativeStatus(status) {
      if (
        state !== "otp_required" ||
        !otpOpen ||
        status.status !== "verified" ||
        !activeChallengeId ||
        status.siteId !== options.siteId ||
        status.gateSessionId !== options.gateSessionId ||
        status.challengeId !== activeChallengeId
      ) {
        return false;
      }
      otpOpen = false;
      activeChallengeId = undefined;
      if (!transition("verified")) return false;
      effect({ type: "stop_authoritative_polling" });
      effect({ type: "unfreeze_page" });
      return true;
    },

    resumeObservation() {
      if (state !== "verified" || observationResumed) return false;
      observationResumed = true;
      effect({ type: "start_observation", fresh: true });
      return true;
    },

    getSnapshot: () => currentSnapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      disposed = true;
      listeners.clear();
      if (timeout !== undefined) clearTimer(timeout);
      timeout = undefined;
    },
  };
}

function isValidChallengeId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 200;
}
