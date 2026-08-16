import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { signSiteClearance } from "@powerotp/botblocker-signing";
import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type DecisionRevisionEnvelope,
} from "@powerotp/contracts";
import {
  createMemoryGateSessionStore,
  type GateSession,
} from "@powerotp/gate-node";
import { NextRequest } from "next/server";

import { createPowerOtpNext, type GateNextOptions } from "./index.js";

const siteId = "site_1234567890123456";
const webhookId = `bwh_${"A".repeat(120)}.${"B".repeat(43)}`;
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const visitorToken = "visitor_token_server_only_12345678901234567890";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};

test("signed clearance is local, bound, and cannot override active OTP", async () => {
  const store = createMemoryGateSessionStore();
  let decisionCalls = 0;
  const adapter = createPowerOtpNext(baseOptions({
    sessionStore: store,
    services: {
      requestDecision() {
        decisionCalls += 1;
        return Promise.resolve(unavailable());
      },
    },
  }));
  const waits: Promise<unknown>[] = [];
  const initial = await adapter.proxy(request("/private"), event(waits));
  await Promise.all(waits);
  assert.equal(decisionCalls, 0);
  const gateCookie = cookie(initial, "powerotp_gate");
  const gateSessionId = value(gateCookie);
  const now = Date.now();
  const clearance = signSiteClearance(
    {
      signatureStatus: "unsigned",
      siteId,
      gateSessionId,
      audience,
      nonce: "next_clearance_nonce_123456",
      issuedAt: now - 1,
      expiresAt: now + 60_000,
    },
    { keyId: verificationKeys.active.keyId, privateKey: keyPair.privateKey },
  );

  const cleared = await adapter.proxy(
    request("/private", { headers: { cookie: `${gateCookie}; powerotp_access=${encode(clearance)}` } }),
    event([]),
  );
  assert.equal(decisionCalls, 0);
  assert.equal(adapter.getRequestState(forwardedHeaders(cleared)).status, "clearance");

  const session = await store.get(gateSessionId);
  assert.ok(session);
  session.activeChallenge = challenge();
  session.recommendation = {
    lifecycle: "otp_required",
    recommendation: "otp_required",
    decision: "otp",
    decisionPending: false,
    otpOpen: true,
  };
  await store.set(session);
  const conflictWaits: Promise<unknown>[] = [];
  const conflicted = await adapter.proxy(
    request("/private", { headers: { cookie: `${gateCookie}; powerotp_access=${encode(clearance)}` } }),
    event(conflictWaits),
  );
  await Promise.all(conflictWaits);
  assert.equal(decisionCalls, 0);
  assert.equal(adapter.getRequestState(forwardedHeaders(conflicted)).status, "otp");
});

test("late allow issues clearance only after decision and clearance verification", async () => {
  const adapter = createPowerOtpNext(baseOptions({
    services: {
      requestDecision: async (_context, session) => {
        const now = Date.now();
        return {
          status: "decision",
          visitorToken,
          candidate: decision("allow", session),
          clearance: signSiteClearance(
            {
              signatureStatus: "unsigned",
              siteId,
              gateSessionId: session.id,
              audience,
              nonce: "next_late_allow_clearance_123456",
              issuedAt: now - 1,
              expiresAt: now + 60_000,
            },
            { keyId: verificationKeys.active.keyId, privateKey: keyPair.privateKey },
          ),
        };
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  }));
  const waits: Promise<unknown>[] = [];
  const initial = await adapter.proxy(request("/private"), event(waits));
  const gateCookie = cookie(initial, "powerotp_gate");
  await Promise.all(waits);
  await adapter.route(
    bridgeRequest("/_powerotp/initial-evidence", gateCookie, initialEvidence()),
  );

  const delivered = await adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  const clearanceCookie = delivered.headers
    .getSetCookie()
    .find((item) => item.startsWith("powerotp_access="));
  assert.match(clearanceCookie ?? "", /; HttpOnly; SameSite=Lax; Secure;/);
  assert.ok(!(await delivered.text()).includes(siteCredential));
});

test("timeout publishes fail-open while pending work can publish a late allow", async () => {
  let resolveDecision!: (value: {
    status: "decision";
    visitorToken: string;
    candidate: DecisionRevisionEnvelope;
  }) => void;
  let decisionSession: Readonly<GateSession> | undefined;
  const pending = new Promise<Parameters<typeof resolveDecision>[0]>((resolve) => {
    resolveDecision = resolve;
  });
  const adapter = createPowerOtpNext(baseOptions({
    decisionTimeoutMs: 50,
    services: {
      requestDecision(_request, session) {
        decisionSession = session;
        return pending;
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  }));
  const initial = await adapter.proxy(request("/private"), event([]));
  const gateCookie = cookie(initial, "powerotp_gate");
  await adapter.route(bridgeRequest("/_powerotp/initial-evidence", gateCookie, initialEvidence()));
  const deliveredPromise = adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  await waitFor(() => decisionSession !== undefined);
  await new Promise((resolve) => setTimeout(resolve, 75));

  const timedOut = await adapter.proxy(
    request("/private", { headers: { cookie: gateCookie } }),
    event([]),
  );
  const failOpen = adapter.getRequestState(forwardedHeaders(timedOut));
  assert.equal(failOpen.status, "fail_open");
  if (failOpen.advisory) assert.equal(failOpen.recommendation.decisionPending, true);

  resolveDecision({
    status: "decision",
    visitorToken,
    candidate: decision("allow", decisionSession!),
  });
  const delivered = await deliveredPromise;
  const candidate = (await delivered.json()).candidate;
  await adapter.route(bridgeRequest("/_powerotp/decision/verify", gateCookie, { candidate }));
  const late = await adapter.proxy(
    request("/private", { headers: { cookie: gateCookie } }),
    event([]),
  );
  const allowed = adapter.getRequestState(forwardedHeaders(late));
  assert.equal(allowed.status, "allow");
  if (allowed.advisory) {
    assert.equal(allowed.recommendation.lifecycle, "observing");
    assert.equal(allowed.recommendation.decisionPending, false);
  }
});

test("first contact uses the credential and later calls use only the server-held token", async () => {
  let requestCalls = 0;
  let firstCredential: string | undefined;
  let firstPath: string | undefined;
  let laterToken: string | undefined;
  const adapter = createPowerOtpNext(baseOptions({
    services: {
      requestDecision(request, session) {
        requestCalls += 1;
        firstCredential = request.siteCredential;
        firstPath = request.context.path;
        return Promise.resolve({
          status: "decision",
          visitorToken,
          candidate: decision("allow", session),
        });
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      assessBrowser: async (_report, authorization) => {
        laterToken = authorization.visitorToken;
        return {
          ...unavailable(),
          leakedToken: authorization.visitorToken,
        };
      },
    },
  }));
  const initial = await adapter.proxy(request("/private?secret=discarded"), event([]));
  const gateCookie = cookie(initial, "powerotp_gate");
  await adapter.route(bridgeRequest("/_powerotp/initial-evidence", gateCookie, initialEvidence()));
  const delivered = await adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  const deliveredBody = await delivered.json() as Record<string, unknown>;

  assert.equal(requestCalls, 1);
  assert.equal(firstCredential, siteCredential);
  assert.equal(firstPath, "/private");
  assert.ok(!JSON.stringify(deliveredBody).includes(visitorToken));
  assert.ok(!JSON.stringify(deliveredBody).includes(siteCredential));

  await adapter.route(bridgeRequest("/_powerotp/decision/verify", gateCookie, {
    candidate: deliveredBody.candidate,
  }));
  const assessment = await adapter.route(
    bridgeRequest("/_powerotp/browser-assessment", gateCookie, {
      protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
      trigger: "initial",
      sequence: {
        gateSessionId: value(gateCookie),
        sequence: 0,
        issuedAt: Date.now(),
      },
      evidence: initialEvidence().evidence,
    }),
  );
  assert.equal(assessment.status, 503);
  assert.equal(laterToken, visitorToken);
  assert.ok(!(await assessment.text()).includes(visitorToken));

  const repeated = await adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  assert.equal(repeated.status, 503);
  assert.equal(requestCalls, 1);
  assert.ok(!(await repeated.text()).includes(visitorToken));
});

test("late OTP persists across polling failure until authoritative acknowledgement", async () => {
  let pollFails = true;
  let resolveDecision!: (value: {
    status: "decision";
    visitorToken: string;
    candidate: DecisionRevisionEnvelope;
    challenge: ReturnType<typeof challenge>;
  }) => void;
  let decisionSession: Readonly<GateSession> | undefined;
  const pending = new Promise<Parameters<typeof resolveDecision>[0]>((resolve) => {
    resolveDecision = resolve;
  });
  const adapter = createPowerOtpNext(baseOptions({
    services: {
      requestDecision(_context, session) {
        decisionSession = session;
        return pending;
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      launchChallenge: async () => challenge(),
      pollChallenge: async (_challenge, _authorization, session) => {
        if (pollFails) throw new Error("dependency unavailable");
        return {
          status: "verified",
          siteId,
          gateSessionId: session.id,
          challengeId: challenge().challengeId,
        };
      },
    },
  }));
  const waits: Promise<unknown>[] = [];
  const initial = await adapter.proxy(request("/private"), event(waits));
  const gateCookie = cookie(initial, "powerotp_gate");
  await Promise.all(waits);
  await adapter.route(
    bridgeRequest("/_powerotp/initial-evidence", gateCookie, initialEvidence()),
  );

  const deliveredPromise = adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  await waitFor(() => decisionSession !== undefined);
  await new Promise((resolve) => setTimeout(resolve, 75));
  const failOpen = adapter.getRequestState(forwardedHeaders(await adapter.proxy(
    request("/private", { headers: { cookie: gateCookie } }),
    event([]),
  )));
  assert.equal(failOpen.status, "fail_open");
  resolveDecision({
    status: "decision",
    visitorToken,
    candidate: decision("otp", decisionSession!),
    challenge: challenge(),
  });
  const delivered = await deliveredPromise;
  const candidate = (await delivered.json()).candidate;
  const verified = await adapter.route(
    bridgeRequest("/_powerotp/decision/verify", gateCookie, { candidate }),
  );
  assert.equal((await verified.json()).verified, true);
  const otpState = adapter.getRequestState(forwardedHeaders(await adapter.proxy(
    request("/private", { headers: { cookie: gateCookie } }),
    event([]),
  )));
  assert.equal(otpState.status, "otp");
  if (otpState.advisory) assert.equal(otpState.recommendation.lifecycle, "otp_required");
  const opened = await adapter.route(emptyPostBridgeRequest(
    "/_powerotp/challenge/open",
    gateCookie,
  ));
  assert.equal(opened.status, 200);

  const failed = await adapter.route(bridgeRequest("/_powerotp/challenge/status", gateCookie));
  assert.equal(failed.status, 503);
  const retained = await bootstrap(adapter, gateCookie);
  assert.equal(retained.restoredSecurityState.state, "otp_required");

  pollFails = false;
  const passed = await adapter.route(bridgeRequest("/_powerotp/challenge/status", gateCookie));
  assert.equal((await passed.json()).status, "verified");
  assert.equal((await bootstrap(adapter, gateCookie)).restoredSecurityState.state, "otp_required");

  const acknowledged = await adapter.route(
    bridgeRequest("/_powerotp/challenge/ack", gateCookie, {
      challengeId: challenge().challengeId,
    }),
  );
  assert.equal((await acknowledged.json()).status, "acknowledged");
  assert.equal((await bootstrap(adapter, gateCookie)).challenge, undefined);
});

test("invalid trust-all proxy configuration fails at startup", () => {
  assert.throws(
    () => createPowerOtpNext(baseOptions({
      trustedProxy: {
        header: "x-forwarded-for",
        trustedRemoteAddresses: ["*"],
        select: "last",
      },
    })),
    /explicit IP/,
  );
});

function baseOptions(overrides: Partial<GateNextOptions>): GateNextOptions {
  return {
    siteId,
    webhookId,
    audience,
    siteCredential,
    verificationKeys,
    decisionTimeoutMs: 50,
    ...overrides,
  };
}

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(`${audience}${path}`, init));
}

function bridgeRequest(path: string, gateCookie: string, body?: unknown): NextRequest {
  return request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: gateCookie,
      "x-powerotp-bridge": "1",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function emptyPostBridgeRequest(path: string, gateCookie: string): NextRequest {
  return request(path, {
    method: "POST",
    headers: {
      cookie: gateCookie,
      "x-powerotp-bridge": "1",
    },
  });
}

function event(waits: Promise<unknown>[]) {
  return {
    waitUntil(value: Promise<unknown>) {
      waits.push(value);
    },
  } as never;
}

function forwardedHeaders(response: Response) {
  return {
    get(name: string) {
      return response.headers.get(`x-middleware-request-${name}`);
    },
  };
}

function cookie(response: Response, name: string): string {
  const item = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  assert.ok(item);
  return item.split(";", 1)[0]!;
}

function value(cookieValue: string): string {
  return cookieValue.slice(cookieValue.indexOf("=") + 1);
}

function encode(clearance: unknown): string {
  return Buffer.from(JSON.stringify(clearance), "utf8").toString("base64url");
}

function decision(outcome: "allow" | "otp", session: Readonly<GateSession>): DecisionRevisionEnvelope {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    sequence: { gateSessionId: session.id, sequence: 0, issuedAt: Date.now() },
    outcome,
    audience,
    nonce: `next_decision_${outcome}_123456`,
    expiresAt: Date.now() + 60_000,
  };
}

function challenge() {
  return {
    challengeId: "challenge_123456789",
    challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
    challengeOrigin: "https://verify.powerotp.com",
  };
}

function initialEvidence() {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    proofs: {},
    evidence: {
      routePath: "/",
      clicks: [],
      mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
      scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
      honeypotActivations: [],
    },
  };
}

function unavailable() {
  return {
    status: "unavailable" as const,
    reason: "not_implemented" as const,
    message: "This service is not available",
    retryable: false,
  };
}

async function bootstrap(
  adapter: ReturnType<typeof createPowerOtpNext>,
  gateCookie: string,
): Promise<Record<string, any>> {
  const response = await adapter.route(bridgeRequest("/_powerotp/session", gateCookie));
  return response.json() as Promise<Record<string, any>>;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
