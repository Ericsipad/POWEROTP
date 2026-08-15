import assert from "node:assert/strict";
import { test } from "node:test";

import { BOTBLOCKER_PROTOCOL_VERSION, type DecisionRevisionEnvelope } from "@powerotp/contracts";
import { Window as HappyWindow } from "happy-dom";

import { createGateBrowserCoordinator } from "./browser.js";
import type { BrowserBootstrap, ChallengeMetadata } from "./types.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const gateSessionId = "gate_session_123456789";

test("browser bridge derives sensor sequence from trusted bootstrap and applies revisions", async (context) => {
  const window = new HappyWindow({ url: `${audience}/` });
  let coordinator: Awaited<ReturnType<typeof createGateBrowserCoordinator>> | undefined;
  context.after(async () => {
    coordinator?.dispose();
    await window.happyDOM.close();
  });
  const reports: unknown[] = [];
  const calls: Array<{ path: string; marker: string | null }> = [];
  const fetcher = createFetch(async (path, init) => {
    calls.push({
      path,
      marker: new Headers(init?.headers).get("x-powerotp-bridge"),
    });
    if (path === "/_powerotp/initial-evidence") return json({ status: "accepted" });
    if (path === "/_powerotp/session") return json(bootstrap(5));
    if (path === "/_powerotp/decision") return json(decisionResponse(decision(4, "allow")));
    if (path === "/_powerotp/decision/verify") {
      const candidate = body(init).candidate;
      return json({ verified: true, decision: candidate });
    }
    if (path === "/_powerotp/browser-assessment") {
      reports.push(JSON.parse(String(init?.body)));
      return json(decisionResponse(decision(5, "allow")));
    }
    throw new Error(`Unexpected bridge path ${path}`);
  });

  coordinator = await createGateBrowserCoordinator({
    window: window as unknown as Window,
    document: window.document as unknown as Document,
    sensorVersion: "sensor-v1",
    fetch: fetcher,
  });
  coordinator.start();
  await waitFor(() => coordinator.controller.getSnapshot().lifecycle === "observing");

  window.history.pushState({}, "", "/next?secret=discarded");
  await waitFor(() => coordinator.controller.getSnapshot().lastApplied?.sequence === 5);

  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    trigger: "partial",
    reason: "navigation",
    sequence: {
      gateSessionId,
      sequence: 5,
      issuedAt: (reports[0] as { sequence: { issuedAt: number } }).sequence.issuedAt,
    },
    evidence: {
      routePath: "/",
      clicks: [],
      mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
      scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
      honeypotActivations: [],
      environment: {
        evidenceVersion: 1,
        sensorVersion: "sensor-v1",
        automationIndicators: ["webdriver"],
      },
    },
  });
  assert.ok(calls.every((call) => call.marker === "1"));
});

test("verified OTP remains advisory until explicitly opened", async (context) => {
  const window = new HappyWindow({ url: `${audience}/` });
  let coordinator: Awaited<ReturnType<typeof createGateBrowserCoordinator>> | undefined;
  context.after(async () => {
    coordinator?.dispose();
    await window.happyDOM.close();
  });
  const challenge: ChallengeMetadata = {
    challengeId: "challenge_123456789",
    challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
    challengeOrigin: "https://verify.powerotp.com",
  };
  const otp = decision(0, "otp");
  let openerCalls = 0;
  const fetcher = createFetch(async (path, init) => {
    if (path === "/_powerotp/initial-evidence") return json({ status: "accepted" });
    if (path === "/_powerotp/session") return json(bootstrap(0));
    if (path === "/_powerotp/decision") return json(decisionResponse(otp));
    if (path === "/_powerotp/decision/verify") {
      return json({ verified: true, decision: body(init).candidate });
    }
    if (path === "/_powerotp/challenge/open") openerCalls += 1;
    throw new Error(`Unexpected bridge path ${path}`);
  });

  coordinator = await createGateBrowserCoordinator({
    window: window as unknown as Window,
    document: window.document as unknown as Document,
    sensorVersion: "sensor-v1",
    pollIntervalMs: 1,
    fetch: fetcher,
  });
  coordinator.start();
  await waitFor(() => coordinator.controller.getSnapshot().lifecycle === "otp_required");

  assert.equal(window.document.querySelector("[data-powerotp-botblocker-lock]"), null);
  assert.equal(coordinator.getSnapshot().otpOpen, false);
  assert.equal(openerCalls, 0);
  assert.equal(challenge.challengeId, "challenge_123456789");
});

test("explicit openOtp uses an empty request and polling alone verifies", async (context) => {
  const window = new HappyWindow({ url: `${audience}/` });
  let coordinator: Awaited<ReturnType<typeof createGateBrowserCoordinator>> | undefined;
  context.after(async () => {
    coordinator?.dispose();
    await window.happyDOM.close();
  });
  const challenge: ChallengeMetadata = {
    challengeId: "challenge_123456789",
    challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
    challengeOrigin: "https://verify.powerotp.com",
  };
  let status = "pending" as "pending" | "verified";
  let statusCalls = 0;
  let acknowledgements = 0;
  const fetcher = createFetch(async (path, init) => {
    if (path === "/_powerotp/initial-evidence") return json({ status: "accepted" });
    if (path === "/_powerotp/session") return json(bootstrap(0));
    if (path === "/_powerotp/decision") return json(decisionResponse(decision(0, "otp")));
    if (path === "/_powerotp/decision/verify") {
      return json({ verified: true, decision: body(init).candidate });
    }
    if (path === "/_powerotp/challenge/open") {
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).has("content-type"), false);
      return json(challenge);
    }
    if (path === "/_powerotp/challenge/status") {
      statusCalls += 1;
      if (statusCalls === 1) {
        return json({
          status: "unavailable",
          reason: "dependency_unavailable",
          retryable: true,
        }, 503);
      }
      return json({
        status,
        siteId,
        gateSessionId,
        challengeId: challenge.challengeId,
      });
    }
    if (path === "/_powerotp/challenge/ack") {
      acknowledgements += 1;
      assert.deepEqual(body(init), { challengeId: challenge.challengeId });
      return json({ status: "acknowledged" });
    }
    throw new Error(`Unexpected bridge path ${path}`);
  });
  coordinator = await createGateBrowserCoordinator({
    window: window as unknown as Window,
    document: window.document as unknown as Document,
    sensorVersion: "sensor-v1",
    pollIntervalMs: 1,
    fetch: fetcher,
  });
  coordinator.start();
  await waitFor(() => coordinator?.getSnapshot().lifecycle === "otp_required");

  assert.equal(await coordinator.openOtp(), true);
  assert.equal(coordinator.getSnapshot().otpOpen, true);
  assert.ok(window.document.querySelector("[data-powerotp-botblocker-lock]"));
  await waitFor(() => statusCalls >= 1);
  assert.equal(coordinator.getSnapshot().lifecycle, "otp_required");

  window.dispatchEvent(new window.MessageEvent("message", {
    origin: challenge.challengeOrigin,
    data: { type: "powerotp:verified", challengeId: challenge.challengeId },
  }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(coordinator.getSnapshot().lifecycle, "otp_required");
  assert.equal(acknowledgements, 0);

  status = "verified";
  await waitFor(() => coordinator?.getSnapshot().lifecycle === "verified");
  await waitFor(() => acknowledgements === 1);
  assert.equal(window.document.querySelector("[data-powerotp-botblocker-lock]"), null);
});

function bootstrap(startingSequence: number): BrowserBootstrap {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    audience,
    gateSessionId,
    startingSequence,
    decisionTimeoutMs: 200,
  };
}

function decision(
  sequence: number,
  outcome: "allow" | "otp",
): DecisionRevisionEnvelope {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    sequence: {
      gateSessionId,
      sequence,
      issuedAt: Date.now(),
    },
    outcome,
    audience,
    nonce: `decision_nonce_${sequence.toString().padStart(8, "0")}`,
    expiresAt: Date.now() + 60_000,
  };
}

function decisionResponse(
  candidate: DecisionRevisionEnvelope,
  challenge?: ChallengeMetadata,
) {
  return {
    status: "decision",
    candidate,
    ...(challenge ? { challenge } : {}),
  };
}

function createFetch(
  handler: (path: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const value = typeof input === "string" ? input : input.toString();
    return handler(new URL(value, audience).pathname, init);
  }) as typeof fetch;
}

function body(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for browser gate state");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
