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
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};

test("signed clearance is local, bound, and cannot override active OTP", async () => {
  const store = createMemoryGateSessionStore();
  let decisionCalls = 0;
  const adapter = createPowerOtpNext(baseOptions({
    sessionStore: store,
    protect: () => true,
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
  assert.equal(decisionCalls, 1);
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

  await adapter.proxy(
    request("/private", { headers: { cookie: `${gateCookie}; powerotp_access=${encode(clearance)}` } }),
    event([]),
  );
  assert.equal(decisionCalls, 1);

  const session = await store.get(gateSessionId);
  assert.ok(session);
  session.activeChallenge = challenge();
  await store.set(session);
  const conflictWaits: Promise<unknown>[] = [];
  await adapter.proxy(
    request("/private", { headers: { cookie: `${gateCookie}; powerotp_access=${encode(clearance)}` } }),
    event(conflictWaits),
  );
  await Promise.all(conflictWaits);
  assert.equal(decisionCalls, 2);
});

test("late allow issues clearance only after decision and clearance verification", async () => {
  const adapter = createPowerOtpNext(baseOptions({
    protect: () => true,
    services: {
      requestDecision: async (_context, session) => {
        const now = Date.now();
        return {
          status: "decision",
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

  const delivered = await adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  const clearanceCookie = delivered.headers
    .getSetCookie()
    .find((item) => item.startsWith("powerotp_access="));
  assert.match(clearanceCookie ?? "", /; HttpOnly; SameSite=Lax; Secure;/);
  assert.ok(!(await delivered.text()).includes(siteCredential));
});

test("late OTP persists across polling failure until authoritative acknowledgement", async () => {
  let pollFails = true;
  const adapter = createPowerOtpNext(baseOptions({
    protect: () => true,
    services: {
      requestDecision: async (_context, session) => ({
        status: "decision",
        candidate: decision("otp", session),
        challenge: challenge(),
      }),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      pollChallenge: async (_challenge, session) => {
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

  const delivered = await adapter.route(bridgeRequest("/_powerotp/decision", gateCookie, {}));
  const candidate = (await delivered.json()).candidate;
  const verified = await adapter.route(
    bridgeRequest("/_powerotp/decision/verify", gateCookie, { candidate }),
  );
  assert.equal((await verified.json()).verified, true);

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
    audience,
    siteCredential,
    verificationKeys,
    decisionTimeoutMs: 50,
    protect: () => false,
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

function event(waits: Promise<unknown>[]) {
  return {
    waitUntil(value: Promise<unknown>) {
      waits.push(value);
    },
  } as never;
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
