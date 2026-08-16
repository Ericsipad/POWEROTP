import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import {
  signSiteClearance,
} from "@powerotp/botblocker-signing";
import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type DecisionRevisionEnvelope,
} from "@powerotp/contracts";
import {
  createMemoryGateSessionStore,
  type GateSession,
} from "@powerotp/gate-node";
import express from "express";

import {
  createPowerOtpBotBlocker,
  type GateExpressOptions,
  type PowerOtpRequest,
} from "./index.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const visitorToken = "visitor_token_server_only_12345678901234567890";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

test("signed clearance verifies locally and rejects expiry or binding mismatches", async () => {
  const { origin } = await start({});
  const initial = await fetch(`${origin}/private`);
  const gateCookie = sessionCookie(initial);
  const gateSessionId = cookieValue(gateCookie);
  const now = Date.now();

  const cases = [
    {
      name: "valid",
      status: "clearance",
      claims: { siteId, gateSessionId, audience, issuedAt: now - 1, expiresAt: now + 60_000 },
    },
    {
      name: "expired",
      status: "checking",
      claims: { siteId, gateSessionId, audience, issuedAt: now - 60_000, expiresAt: now - 1 },
    },
    {
      name: "wrong site",
      status: "checking",
      claims: {
        siteId: "site_6543210987654321",
        gateSessionId,
        audience,
        issuedAt: now - 1,
        expiresAt: now + 60_000,
      },
    },
    {
      name: "wrong session",
      status: "checking",
      claims: {
        siteId,
        gateSessionId: "wrong_gate_session_123456",
        audience,
        issuedAt: now - 1,
        expiresAt: now + 60_000,
      },
    },
    {
      name: "wrong audience",
      status: "checking",
      claims: {
        siteId,
        gateSessionId,
        audience: "https://other.example",
        issuedAt: now - 1,
        expiresAt: now + 60_000,
      },
    },
  ] as const;

  for (const item of cases) {
    const clearance = signSiteClearance(
      {
        signatureStatus: "unsigned",
        ...item.claims,
        nonce: `clearance_${item.name.replace(" ", "_")}_123456`,
      },
      {
        keyId: verificationKeys.active.keyId,
        privateKey: keyPair.privateKey,
      },
    );
    const response = await fetch(`${origin}/private`, {
      headers: {
        cookie: `${gateCookie}; powerotp_access=${encode(clearance)}`,
      },
    });
    assert.equal((await response.json()).status, item.status, item.name);
  }
});

test("an active OTP challenge overrides a previously valid clearance", async () => {
  const store = createMemoryGateSessionStore();
  const { origin } = await start({
    sessionStore: store,
  });
  const initial = await fetch(`${origin}/private`);
  const gateCookie = sessionCookie(initial);
  const gateSessionId = cookieValue(gateCookie);
  const session = await store.get(gateSessionId);
  assert.ok(session);
  session.activeChallenge = challenge();
  await store.set(session);
  const now = Date.now();
  const clearance = signSiteClearance(
    {
      signatureStatus: "unsigned",
      siteId,
      gateSessionId,
      audience,
      nonce: "clearance_conflict_123456",
      issuedAt: now - 1,
      expiresAt: now + 60_000,
    },
    {
      keyId: verificationKeys.active.keyId,
      privateKey: keyPair.privateKey,
    },
  );

  const response = await fetch(`${origin}/private`, {
    headers: { cookie: `${gateCookie}; powerotp_access=${encode(clearance)}` },
  });
  assert.equal((await response.json()).status, "checking");
});

test("late allow is delivered and issues clearance only after both verifications", async () => {
  let resolveDecision!: (result: ReturnType<typeof allowResult>) => void;
  const pending = new Promise<ReturnType<typeof allowResult>>((resolve) => {
    resolveDecision = resolve;
  });
  let currentSession: Readonly<GateSession> | undefined;
  const { origin } = await start({
    services: {
      requestDecision(_context, session) {
        currentSession = session;
        return pending;
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  });
  const initial = await fetch(`${origin}/private`);
  assert.equal((await initial.json()).status, "checking");
  const gateCookie = sessionCookie(initial);
  await submitInitialEvidence(origin, gateCookie);
  const deliveredPromise = decisionRequest(origin, gateCookie);
  await waitFor(() => currentSession !== undefined);
  resolveDecision(allowResult(currentSession!));

  const delivered = await deliveredPromise;
  assert.equal((await delivered.json()).candidate.outcome, "allow");
  const clearanceCookie = delivered.headers
    .getSetCookie()
    .find((value) => value.startsWith("powerotp_access="));
  assert.match(clearanceCookie ?? "", /; HttpOnly; SameSite=Lax; Secure;/);

  const cleared = await fetch(`${origin}/private`, {
    headers: { cookie: `${gateCookie}; ${clearanceCookie?.split(";", 1)[0]}` },
  });
  assert.equal((await cleared.json()).status, "clearance");
});

test("late OTP remains authoritative through polling failure and acknowledgement", async () => {
  let pollFails = true;
  const { origin } = await start({
    services: {
      requestDecision: async (_context, session) => ({
        status: "decision",
        visitorToken,
        candidate: decision("otp", session),
        challenge: challenge(),
      }),
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
  });
  const initial = await fetch(`${origin}/private`);
  const gateCookie = sessionCookie(initial);
  await submitInitialEvidence(origin, gateCookie);
  const delivered = await decisionRequest(origin, gateCookie);
  const candidate = (await delivered.json()).candidate;
  await verifyRequest(origin, gateCookie, candidate);
  const opened = await fetch(`${origin}/_powerotp/challenge/open`, {
    method: "POST",
    headers: bridgeHeaders(gateCookie),
  });
  assert.equal(opened.status, 200);

  const failedPoll = await fetch(`${origin}/_powerotp/challenge/status`, {
    headers: bridgeHeaders(gateCookie),
  });
  assert.equal(failedPoll.status, 503);
  const retained = await bootstrapRequest(origin, gateCookie);
  assert.equal(retained.restoredSecurityState.state, "otp_required");

  pollFails = false;
  const verified = await fetch(`${origin}/_powerotp/challenge/status`, {
    headers: bridgeHeaders(gateCookie),
  });
  assert.equal((await verified.json()).status, "verified");
  const stillRetained = await bootstrapRequest(origin, gateCookie);
  assert.equal(stillRetained.restoredSecurityState.state, "otp_required");

  const ack = await fetch(`${origin}/_powerotp/challenge/ack`, {
    method: "POST",
    headers: bridgeHeaders(gateCookie, true),
    body: JSON.stringify({ challengeId: challenge().challengeId }),
  });
  assert.deepEqual(await ack.json(), { status: "acknowledged" });
  const released = await bootstrapRequest(origin, gateCookie);
  assert.equal(released.challenge, undefined);
});

test("bridge enforces same-origin CSRF controls before creating sessions", async () => {
  const { origin } = await start({});
  const headerCases: HeadersInit[] = [
    {},
    { "x-powerotp-bridge": "1", "sec-fetch-site": "cross-site" },
    {
      "x-powerotp-bridge": "1",
      "sec-fetch-site": "same-origin",
      origin: "https://attacker.example",
    },
  ];
  for (const headers of headerCases) {
    const response = await fetch(`${origin}/_powerotp/session`, { headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("malformed and oversized bridge, path, and header inputs are bounded", async () => {
  const { origin } = await start({
    limits: {
      maxBodyBytes: 256,
      maxPathBytes: 256,
      maxHeaderBytes: 256,
    },
  });
  const bootstrap = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(),
  });
  const gateCookie = sessionCookie(bootstrap);
  for (const body of ["{", JSON.stringify({ padding: "x".repeat(300) })]) {
    const response = await fetch(`${origin}/_powerotp/decision`, {
      method: "POST",
      headers: bridgeHeaders(gateCookie, true),
      body,
    });
    assert.equal(response.status, body === "{" ? 400 : 413);
    assert.deepEqual(await response.json(), {
      status: "error",
      code: "invalid_request",
      message: "Invalid request",
    });
  }
  const unsupported = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(gateCookie),
    body: "{}",
  });
  assert.equal(unsupported.status, 415);

  const longPath = await fetch(`${origin}/${"x".repeat(300)}`);
  assert.equal(longPath.status, 414);
  const largeHeader = await fetch(`${origin}/private`, {
    headers: { "x-large": "x".repeat(300) },
  });
  assert.equal(largeHeader.status, 431);
  const encodedSeparator = await fetch(`${origin}/private%2Fadmin`);
  assert.equal(encodedSeparator.status, 414);
});

test("discovery is strict, credential-free, and creates no customer CleanDataPage route", async () => {
  const { origin } = await start(
    {
      cleanDataPage: {
        url: "https://verify.powerotp.com/project/cleandatapage/1001",
        metadataUrl: "https://verify.powerotp.com/v1/metadata/1001",
      },
    },
    false,
  );
  const discovery = await fetch(`${origin}/.well-known/powerotp-agent`);
  const discoveryBody = await discovery.json();
  assert.deepEqual(discoveryBody, {
    protocolVersion: 1,
    provider: "POWEROTP",
    cleanDataPage: {
      url: "https://verify.powerotp.com/project/cleandatapage/1001",
      metadataUrl: "https://verify.powerotp.com/v1/metadata/1001",
    },
  });
  const head = await fetch(`${origin}/.well-known/powerotp-agent`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const wrongMethod = await fetch(`${origin}/.well-known/powerotp-agent`, {
    method: "POST",
  });
  assert.equal(wrongMethod.status, 405);
  const absent = await fetch(`${origin}/powerotp/aisummary`);
  assert.equal(absent.status, 404);

  const bootstrap = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(),
  });
  const browserResponses = JSON.stringify([
    discoveryBody,
    await bootstrap.text(),
    bootstrap.headers.getSetCookie(),
  ]);
  assert.ok(!browserResponses.includes(siteCredential));
  assert.ok(!browserResponses.includes("potp_bb_"));
});

test("invalid trust-all and malformed proxy configurations fail at startup", () => {
  for (const trustedProxy of [
    {
      header: "x-forwarded-for",
      trustedRemoteAddresses: ["*"],
      select: "last",
    },
    {
      header: "x-forwarded-for",
      trustedRemoteAddresses: [],
      select: "last",
    },
    {
      header: "x-forwarded-for",
      trustedRemoteAddresses: ["127.0.0.1"],
      select: "last",
      expectedProxyCount: 0,
    },
  ] as const) {
    assert.throws(
      () => createPowerOtpBotBlocker(baseOptions({ trustedProxy })),
      /Trusted proxy|Expected proxy/,
    );
  }
});

async function start(
  overrides: Partial<GateExpressOptions>,
  includeFallback = true,
) {
  const app = express();
  const gate = createPowerOtpBotBlocker(baseOptions(overrides));
  app.use(gate.middleware());
  if (includeFallback) {
    app.use((request, response) => {
      response.json((request as PowerOtpRequest).powerOtp);
    });
  }
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}` };
}

function baseOptions(overrides: Partial<GateExpressOptions>): GateExpressOptions {
  return {
    siteId,
    audience,
    siteCredential,
    verificationKeys,
    decisionTimeoutMs: 50,
    cookieSecure: true,
    ...overrides,
  };
}

function allowResult(session: Readonly<GateSession>) {
  const now = Date.now();
  return {
    status: "decision" as const,
    visitorToken,
    candidate: decision("allow", session),
    clearance: signSiteClearance(
      {
        signatureStatus: "unsigned",
        siteId,
        gateSessionId: session.id,
        audience,
        nonce: "clearance_late_allow_123456",
        issuedAt: now - 1,
        expiresAt: now + 60_000,
      },
      {
        keyId: verificationKeys.active.keyId,
        privateKey: keyPair.privateKey,
      },
    ),
  };
}

function decision(
  outcome: "allow" | "otp",
  session: Readonly<GateSession>,
): DecisionRevisionEnvelope {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    sequence: {
      gateSessionId: session.id,
      sequence: 0,
      issuedAt: Date.now(),
    },
    outcome,
    audience,
    nonce: `decision_${outcome}_nonce_123456`,
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

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("powerotp_gate="));
  assert.ok(cookie);
  return cookie.split(";", 1)[0]!;
}

function cookieValue(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

function bridgeHeaders(cookie?: string, json = false): Record<string, string> {
  return {
    "x-powerotp-bridge": "1",
    ...(cookie ? { cookie } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function decisionRequest(origin: string, cookie: string): Promise<Response> {
  return fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: "{}",
  });
}

async function submitInitialEvidence(origin: string, cookie: string): Promise<void> {
  const response = await fetch(`${origin}/_powerotp/initial-evidence`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({
      protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
      proofs: {},
      evidence: {
        routePath: "/",
        clicks: [],
        mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
        scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
        honeypotActivations: [],
      },
    }),
  });
  assert.equal(response.status, 200);
}

async function verifyRequest(
  origin: string,
  cookie: string,
  candidate: unknown,
): Promise<Response> {
  return fetch(`${origin}/_powerotp/decision/verify`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ candidate }),
  });
}

async function bootstrapRequest(
  origin: string,
  cookie: string,
): Promise<Record<string, any>> {
  const response = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(cookie),
  });
  return response.json() as Promise<Record<string, any>>;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
