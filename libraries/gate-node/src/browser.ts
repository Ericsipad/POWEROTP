import type { BehaviorReport } from "@powerotp/contracts";
import {
  createAuthoritativePoller,
  createChallengeMessageHandler,
  createContinuousBrowserSensor,
  createGateController,
  createPageLock,
  type ChallengeUxMessage,
  type GateController,
  type GateEffect,
  type PageLock,
  type DecisionVerification,
} from "@powerotp/gate-core";

import type {
  BrowserBootstrap,
  ChallengeMetadata,
} from "./types.js";

export interface GateBrowserOptions {
  window: Window;
  document: Document;
  sensorVersion: string;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  onError?: (code: "bootstrap" | "bridge") => void;
}

export interface GateBrowserCoordinator {
  controller: GateController;
  start(): void;
  dispose(): void;
}

interface DecisionResponse {
  status: "decision";
  candidate: unknown;
  challenge?: ChallengeMetadata;
}

export async function createGateBrowserCoordinator(
  options: GateBrowserOptions,
): Promise<GateBrowserCoordinator> {
  const fetcher = options.fetch ?? options.window.fetch.bind(options.window);
  const bootstrap = await getJson<BrowserBootstrap>(fetcher, "/_powerotp/session").catch(
    () => {
      options.onError?.("bootstrap");
      throw new Error("POWEROTP gate bootstrap unavailable");
    },
  );
  let challenge = bootstrap.challenge;
  let lock: PageLock | undefined;
  let messageHandler: ((event: MessageEvent<unknown>) => boolean) | undefined;
  let disposed = false;

  const poller = createAuthoritativePoller({
    intervalMs: options.pollIntervalMs ?? 1_000,
    check: async () => {
      const value = await getJson<unknown>(fetcher, "/_powerotp/challenge/status");
      if (!isStatus(value)) return "unavailable";
      if (value.status === "verified" && challenge) {
        if (controller.applyAuthoritativeStatus(value)) {
          await postJson(
            fetcher,
            "/_powerotp/challenge/ack",
            { challengeId: challenge.challengeId },
          ).catch(() => options.onError?.("bridge"));
        }
      }
      return value.status;
    },
    onStatus() {},
  });

  const setChallenge = (value: ChallengeMetadata | undefined) => {
    if (!value) return;
    challenge = value;
  };

  const requestDecision = async (): Promise<unknown> => {
    const response = await postJson<unknown>(fetcher, "/_powerotp/decision", {});
    if (!isDecisionResponse(response)) throw new Error("Decision unavailable");
    setChallenge(response.challenge);
    return response.candidate;
  };

  const verifyDecision = async (candidate: unknown) => {
    const response = await postJson<unknown>(
      fetcher,
      "/_powerotp/decision/verify",
      { candidate },
    );
    return isVerification(response) ? response : { verified: false as const };
  };

  let sensor = createContinuousBrowserSensor({
    window: options.window,
    document: options.document,
    gateSessionId: bootstrap.gateSessionId,
    sensorVersion: options.sensorVersion,
    startingSequence: bootstrap.startingSequence,
    sendReport: async (report: BehaviorReport) => {
      const response = await postJson<unknown>(
        fetcher,
        "/_powerotp/browser-assessment",
        report,
      );
      if (!isDecisionResponse(response)) return undefined;
      setChallenge(response.challenge);
      return response.candidate;
    },
    applyDecisionRevision: (candidate) => controller.applyDecisionRevision(candidate),
  });

  const handleEffect = (effect: GateEffect) => {
    sensor.handleGateEffect(effect);
    if (effect.type === "start_authoritative_polling") poller.start();
    if (effect.type === "stop_authoritative_polling") poller.stop();
    if (effect.type === "freeze_page") freeze();
    if (effect.type === "unfreeze_page") {
      removeMessageHandler();
      lock?.unfreeze();
      queueMicrotask(() => controller.resumeObservation());
    }
  };

  const controller = createGateController({
    siteId: bootstrap.siteId,
    gateSessionId: bootstrap.gateSessionId,
    audience: bootstrap.audience,
    decisionTimeoutMs: bootstrap.decisionTimeoutMs,
    restoredSecurityState: bootstrap.restoredSecurityState,
    requestDecision,
    verifyDecision,
    onStateChange(snapshot) {
      if (snapshot.state === "otp_required" && challenge) {
        controller.bindActiveChallenge(challenge.challengeId);
      }
    },
    onEffect: handleEffect,
  });

  function freeze(): void {
    if (!challenge) {
      options.onError?.("bridge");
      return;
    }
    lock ??= createPageLock({
      document: options.document,
      challengeUrl: challenge.challengeUrl,
      allowedChallengeOrigin: challenge.challengeOrigin,
    });
    lock.freeze();
    removeMessageHandler();
    messageHandler = createChallengeMessageHandler({
      expectedOrigin: challenge.challengeOrigin,
      expectedSource: lock.getMessageSource(),
      challengeId: challenge.challengeId,
      requestAuthoritativePoll: () => poller.triggerNow(),
    });
    options.window.addEventListener("message", messageHandler);
  }

  function removeMessageHandler(): void {
    if (messageHandler) options.window.removeEventListener("message", messageHandler);
    messageHandler = undefined;
  }

  return {
    controller,
    start: () => controller.start(),
    dispose() {
      if (disposed) return;
      disposed = true;
      removeMessageHandler();
      poller.stop();
      sensor.dispose();
      lock?.unfreeze();
      controller.dispose();
    },
  };
}

async function getJson<T>(fetcher: typeof fetch, path: string): Promise<T> {
  const response = await fetcher(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "x-powerotp-bridge": "1",
    },
  });
  if (!response.ok) throw new Error("Bridge request failed");
  return response.json() as Promise<T>;
}

async function postJson<T>(
  fetcher: typeof fetch,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-powerotp-bridge": "1",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Bridge request failed");
  return response.json() as Promise<T>;
}

function isDecisionResponse(value: unknown): value is DecisionResponse {
  return (
    isRecord(value) &&
    value.status === "decision" &&
    "candidate" in value &&
    (!("challenge" in value) || isChallenge(value.challenge))
  );
}

function isChallenge(value: unknown): value is ChallengeMetadata {
  return (
    isRecord(value) &&
    typeof value.challengeId === "string" &&
    typeof value.challengeUrl === "string" &&
    typeof value.challengeOrigin === "string"
  );
}

function isVerification(value: unknown): value is DecisionVerification {
  return (
    isRecord(value) &&
    ((value.verified === false && Object.keys(value).length === 1) ||
      (value.verified === true && "decision" in value))
  );
}

function isStatus(value: unknown): value is {
  status: "pending" | "verified" | "unavailable";
  siteId: string;
  gateSessionId: string;
  challengeId: string;
} {
  return (
    isRecord(value) &&
    (value.status === "pending" ||
      value.status === "verified" ||
      value.status === "unavailable") &&
    typeof value.siteId === "string" &&
    typeof value.gateSessionId === "string" &&
    typeof value.challengeId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type { ChallengeUxMessage };
