import {
  BOTBLOCKER_PROTOCOL_VERSION,
  InitialBrowserProofEvidenceSchema,
  OtpLaunchMetadataSchema,
  type BehaviorReport,
  type GateRecommendationSnapshot,
  type InitialBrowserProofEvidence,
} from "@powerotp/contracts/browser";
import {
  createAuthoritativePoller,
  createChallengeMessageHandler,
  createContinuousBrowserSensor,
  createFingerprintCollector,
  createGateController,
  createPageLock,
  createSensorEvidenceAccumulator,
  pageDimensions,
  type ChallengeUxMessage,
  type GateController,
  type GateEffect,
  type FingerprintCollector,
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
  initialProofs?: InitialBrowserProofEvidence["proofs"];
  fingerprintCollector?: Pick<FingerprintCollector, "collect">;
  onError?: (code: "bootstrap" | "bridge") => void;
}

export interface GateBrowserCoordinator {
  controller: GateController;
  start(): void;
  getSnapshot(): GateRecommendationSnapshot;
  subscribe(listener: () => void): () => void;
  openOtp(): Promise<boolean>;
  dispose(): void;
}

interface DecisionResponse {
  status: "decision";
  candidate: unknown;
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
  const fingerprint = await (
    options.fingerprintCollector ??
    createFingerprintCollector({ scope: options.window })
  ).collect(bootstrap.gateSessionId);
  const initialBrowser = InitialBrowserProofEvidenceSchema.parse({
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    evidence: createSensorEvidenceAccumulator({
      sensorVersion: options.sensorVersion,
      webdriver: options.window.navigator.webdriver === true,
    }).snapshot(
      options.window.location.pathname,
      pageDimensions(options.document),
    ),
    fingerprint,
    proofs: options.initialProofs ?? {},
  });
  await postJson(fetcher, "/_powerotp/initial-evidence", initialBrowser).catch(() => {
    options.onError?.("bootstrap");
    throw new Error("POWEROTP initial evidence bridge unavailable");
  });
  let challenge: ChallengeMetadata | undefined;
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

  const requestDecision = async (): Promise<unknown> => {
    const response = await postJson<unknown>(fetcher, "/_powerotp/decision", {});
    if (!isDecisionResponse(response)) throw new Error("Decision unavailable");
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
        "/_powerotp/report",
        report,
      );
      if (!isDecisionResponse(response)) return undefined;
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
    launchOtp: async () => {
      const launch = OtpLaunchMetadataSchema.safeParse(
        await postEmpty(fetcher, "/_powerotp/challenge/open"),
      );
      if (!launch.success) throw new Error("OTP launch unavailable");
      if (!options.document.body) throw new Error("OTP launch requires document.body");
      removeMessageHandler();
      lock?.unfreeze();
      challenge = launch.data;
      lock = createPageLock({
        document: options.document,
        challengeUrl: launch.data.challengeUrl,
        allowedChallengeOrigin: launch.data.challengeOrigin,
      });
      return launch.data;
    },
    onEffect: handleEffect,
  });

  function freeze(): void {
    if (!challenge) {
      options.onError?.("bridge");
      return;
    }
    if (!lock) {
      options.onError?.("bridge");
      return;
    }
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
    getSnapshot: () => controller.getSnapshot(),
    subscribe: (listener) => controller.subscribe(listener),
    openOtp: () => controller.openOtp(),
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

async function postEmpty<T>(fetcher: typeof fetch, path: string): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "x-powerotp-bridge": "1",
    },
  });
  if (!response.ok) throw new Error("Bridge request failed");
  return response.json() as Promise<T>;
}

function isDecisionResponse(value: unknown): value is DecisionResponse {
  return (
    isRecord(value) &&
    value.status === "decision" &&
    "candidate" in value &&
    Object.keys(value).length === 2
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
