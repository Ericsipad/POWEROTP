import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import { signSiteClearance } from "@powerotp/botblocker-signing";
import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type DecisionRevisionEnvelope,
} from "@powerotp/contracts";

import { createPowerOtpServer } from "./server.js";
import { createGateNodeFixture } from "./fixture.js";
import { createMemoryGateSessionStore } from "./session.js";
import type { GateNodeOptions, GateSession } from "./types.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};
const servers: ReturnType<typeof createPowerOtpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

test("infrastructure, health, and static routes cannot be protected", async () => {
  let protectCalls = 0;
  const { origin } = await start({
    protect() {
      protectCalls += 1;
      return true;
    },
  });
  for (const path of [
    "/health",
    "/.well-known/health/live",
    "/_next/app.js",
    "/assets/logo.svg",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).access, "excluded");
  }
  assert.equal(protectCalls, 0);
  const api = await fetch(`${origin}/api/data.json`);
  assert.equal((await api.json()).access, "optimistic");
  assert.equal(protectCalls, 1);
});

test("timeout is optimistic and leaves the decision pending", async () => {
  let resolveDecision!: (value: ReturnType<typeof decisionResult>) => void;
  const pending = new Promise<ReturnType<typeof decisionResult>>((resolve) => {
    resolveDecision = resolve;
  });
  const { origin } = await start({
    decisionTimeoutMs: 2_000,
    protect: () => true,
    services: {
      requestDecision: () => pending,
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  });

  const first = await Promise.race([
    fetch(`${origin}/private`),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Application response waited for decision timeout")), 250),
    ),
  ]);
  assert.equal((await first.json()).access, "optimistic");
  const cookie = sessionCookie(first);
  resolveDecision(decisionResult("allow"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const delivered = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: "{}",
  });
  assert.equal(delivered.status, 200);
  assert.equal((await delivered.json()).candidate.outcome, "allow");
});

test("locally verifies and issues a hardened signed clearance cookie", async () => {
  const { origin } = await start({
    protect: () => true,
    services: {
      async requestDecision(_context, session) {
        const candidate = decision("allow", session);
        return {
          status: "decision",
          candidate,
          clearance: signSiteClearance(
            {
              signatureStatus: "unsigned",
              siteId,
              gateSessionId: session.id,
              audience,
              nonce: "clearance_nonce_123456",
              issuedAt: Date.now() - 1,
              expiresAt: Date.now() + 60_000,
            },
            {
              keyId: verificationKeys.active.keyId,
              privateKey: keyPair.privateKey,
            },
          ),
        };
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  });

  const page = await fetch(`${origin}/private`);
  assert.equal((await page.json()).access, "optimistic");
  const response = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(sessionCookie(page), true),
    body: "{}",
  });
  const cookies = response.headers.getSetCookie();
  const clearance = cookies.find((value) => value.startsWith("powerotp_access="));
  assert.match(clearance ?? "", /; HttpOnly; SameSite=Lax; Secure;/);
  assert.equal((await response.json()).candidate.outcome, "allow");
  assert.ok(!JSON.stringify(await fetchJson(`${origin}/.well-known/powerotp-agent`)).includes("potp_bb_"));
});

test("decision bridge validates through the verifier and restores trusted ordering", async () => {
  const { origin } = await start({
    protect: () => true,
    services: {
      requestDecision: async (_context, session) => ({
        status: "decision",
        candidate: decision("allow", session),
      }),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  });
  const page = await fetch(`${origin}/private`);
  const cookie = sessionCookie(page);
  const delivered = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: "{}",
  });
  const candidate = (await delivered.json()).candidate;
  const verified = await fetch(`${origin}/_powerotp/decision/verify`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ candidate }),
  });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).verified, true);
  const bootstrap = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(cookie),
  });
  const state = await bootstrap.json();
  assert.equal(state.restoredSecurityState.lastApplied.sequence, 0);
  assert.deepEqual(state.restoredSecurityState.acceptedNonces, [
    "decision_nonce_1234567",
  ]);
});

test("authoritative verification retains OTP state until browser acknowledgement", async () => {
  const { origin } = await start({
    protect: () => true,
    services: {
      requestDecision: async (_context, session) => ({
        status: "decision",
        candidate: decision("otp", session),
        challenge: {
          challengeId: "challenge_123456789",
          challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
          challengeOrigin: "https://verify.powerotp.com",
        },
      }),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      pollChallenge: async (challenge, session) => ({
        status: "verified",
        siteId,
        gateSessionId: session.id,
        challengeId: challenge.challengeId,
      }),
    },
  });
  const page = await fetch(`${origin}/private`);
  const cookie = sessionCookie(page);
  const delivered = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: "{}",
  });
  const candidate = (await delivered.json()).candidate;
  await fetch(`${origin}/_powerotp/decision/verify`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ candidate }),
  });
  const status = await fetch(`${origin}/_powerotp/challenge/status`, {
    headers: bridgeHeaders(cookie),
  });
  assert.equal((await status.json()).status, "verified");

  const beforeAck = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(cookie),
  });
  assert.equal((await beforeAck.json()).restoredSecurityState.state, "otp_required");

  const ack = await fetch(`${origin}/_powerotp/challenge/ack`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ challengeId: "challenge_123456789" }),
  });
  assert.deepEqual(await ack.json(), { status: "acknowledged" });
  const afterAck = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(cookie),
  });
  assert.equal((await afterAck.json()).challenge, undefined);
});

test("discovery is strict and never creates a customer CleanDataPage route", async () => {
  const { origin } = await start({
    cleanDataPage: {
      url: "https://verify.powerotp.com/project/cleandatapage/1001",
      metadataUrl: "https://verify.powerotp.com/v1/metadata/1001",
    },
  });
  const discovery = await fetchJson(`${origin}/.well-known/powerotp-agent`);
  assert.deepEqual(discovery, {
    protocolVersion: 1,
    provider: "POWEROTP",
    cleanDataPage: {
      url: "https://verify.powerotp.com/project/cleandatapage/1001",
      metadataUrl: "https://verify.powerotp.com/v1/metadata/1001",
    },
  });
  const absent = await fetch(`${origin}/powerotp/aisummary`);
  assert.equal((await absent.json()).access, "excluded");
});

test("same-origin bridge rejects cross-origin browser requests before sessions", async () => {
  const { origin } = await start();
  const response = await fetch(`${origin}/_powerotp/session`, {
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      "x-powerotp-bridge": "1",
    },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(await response.json(), {
    status: "error",
    code: "invalid_request",
    message: "Invalid request",
  });
  const missingMarker = await fetch(`${origin}/_powerotp/session`);
  assert.equal(missingMarker.status, 403);
  assert.equal(missingMarker.headers.getSetCookie().length, 0);
});

test("bridge bodies are bounded and unbacked services are typed unavailable", async () => {
  const { origin } = await start({ limits: { maxBodyBytes: 256 } });
  const bootstrap = await fetch(`${origin}/_powerotp/session`, {
    headers: bridgeHeaders(),
  });
  const cookie = sessionCookie(bootstrap);
  const decisionResponse = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: "{}",
  });
  assert.equal(decisionResponse.status, 503);
  assert.deepEqual(await decisionResponse.json(), {
    status: "unavailable",
    reason: "not_implemented",
    message: "This service is not available",
    retryable: false,
  });
  const oversized = await fetch(`${origin}/_powerotp/browser-assessment`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ padding: "x".repeat(300) }),
  });
  assert.equal(oversized.status, 413);
  const oversizedDecision = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(cookie, true),
    body: JSON.stringify({ padding: "x".repeat(300) }),
  });
  assert.equal(oversizedDecision.status, 413);
});

test("trusted proxy configuration cannot trust all callers", () => {
  assert.throws(
    () =>
      createPowerOtpServer({
        siteId,
        audience,
        siteCredential,
        verificationKeys,
        trustedProxy: {
          header: "x-forwarded-for",
          trustedRemoteAddresses: ["*"],
          select: "last",
        },
        protect: () => false,
        handle() {},
      }),
    /explicit IP addresses/,
  );
});

test("bounded session store never evicts an active OTP challenge", async () => {
  const store = createMemoryGateSessionStore(1);
  const active = {
    id: "active_session_123456",
    nextSequence: 0,
    acceptedNonces: [],
    activeChallenge: {
      challengeId: "challenge_123456789",
      challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
      challengeOrigin: "https://verify.powerotp.com",
    },
  };
  await store.set(active);
  await assert.rejects(
    Promise.resolve().then(() =>
      store.set({
        id: "new_session_123456789",
        nextSequence: 0,
        acceptedNonces: [],
      }),
    ),
    /capacity is exhausted/,
  );
  assert.equal(await store.get(active.id), active);
});

test("synchronous service failure preserves immediate optimistic delivery", async () => {
  const { origin } = await start({
    decisionTimeoutMs: 2_000,
    protect: () => true,
    services: {
      requestDecision() {
        throw new Error("unavailable");
      },
    },
  });
  const response = await Promise.race([
    fetch(`${origin}/private`),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Application response was delayed")), 250),
    ),
  ]);
  assert.equal((await response.json()).access, "optimistic");
});

test("an OTP result can never issue its paired clearance", async () => {
  const { origin } = await start({
    protect: () => true,
    services: {
      async requestDecision(_context, session) {
        return {
          status: "decision",
          candidate: decision("otp", session),
          challenge: {
            challengeId: "challenge_123456789",
            challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
            challengeOrigin: "https://verify.powerotp.com",
          },
          clearance: signSiteClearance(
            {
              signatureStatus: "unsigned",
              siteId,
              gateSessionId: session.id,
              audience,
              nonce: "clearance_nonce_123456",
              issuedAt: Date.now() - 1,
              expiresAt: Date.now() + 60_000,
            },
            {
              keyId: verificationKeys.active.keyId,
              privateKey: keyPair.privateKey,
            },
          ),
        };
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
    },
  });
  const page = await fetch(`${origin}/private`);
  const response = await fetch(`${origin}/_powerotp/decision`, {
    method: "POST",
    headers: bridgeHeaders(sessionCookie(page), true),
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.ok(
    response.headers.getSetCookie().every((cookie) => !cookie.startsWith("powerotp_access=")),
  );
});

test("an active OTP challenge overrides an earlier valid clearance", async () => {
  const store = createMemoryGateSessionStore();
  const { origin } = await start({
    protect: () => true,
    sessionStore: store,
  });
  const first = await fetch(`${origin}/private`);
  const gateCookie = sessionCookie(first);
  const gateSessionId = gateCookie.slice(gateCookie.indexOf("=") + 1);
  const session = await store.get(gateSessionId);
  assert.ok(session);
  session.activeChallenge = {
    challengeId: "challenge_123456789",
    challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
    challengeOrigin: "https://verify.powerotp.com",
  };
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
  const encoded = Buffer.from(JSON.stringify(clearance), "utf8").toString("base64url");

  const response = await fetch(`${origin}/private`, {
    headers: {
      cookie: `${gateCookie}; powerotp_access=${encoded}`,
    },
  });
  assert.equal((await response.json()).access, "optimistic");
});

test("minimal raw Node fixture runs without fabricated decisions", async () => {
  const server = createGateNodeFixture({
    siteId,
    audience,
    siteCredential,
    verificationKeys,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.deepEqual(await response.json(), {
    fixture: "gate-node",
    protected: true,
    access: "optimistic",
  });
});

async function start(overrides: Partial<GateNodeOptions> = {}) {
  const server = createPowerOtpServer({
    siteId,
    audience,
    siteCredential,
    verificationKeys,
    decisionTimeoutMs: 50,
    protect: () => false,
    handle(_request, response, state) {
      const body = JSON.stringify(state);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    },
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}` };
}

function decisionResult(
  outcome: "allow" | "otp",
): { status: "decision"; candidate: DecisionRevisionEnvelope } {
  return {
    status: "decision" as const,
    candidate: {
      protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
      siteId,
      sequence: {
        gateSessionId: "replaced_by_service",
        sequence: 0,
        issuedAt: Date.now(),
      },
      outcome,
      audience,
      nonce: "decision_nonce_1234567",
      expiresAt: Date.now() + 60_000,
    },
  };
}

function decision(
  outcome: "allow" | "otp",
  session: Readonly<GateSession>,
): DecisionRevisionEnvelope {
  const result = decisionResult(outcome).candidate;
  result.sequence.gateSessionId = session.id;
  return result;
}

function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("powerotp_gate="));
  assert.ok(cookie);
  return cookie.split(";", 1)[0]!;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}

function bridgeHeaders(cookie?: string, json = false): Record<string, string> {
  return {
    "x-powerotp-bridge": "1",
    ...(cookie ? { cookie } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  };
}
