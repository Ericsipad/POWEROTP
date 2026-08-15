import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import type { RequestContext } from "@powerotp/contracts";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

import {
  createPowerOtpNext,
  type GateNextOptions,
  POWEROTP_PROXY_MATCHER,
} from "./index.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};

test("native proxy matcher orders protected routes before App Router and excludes owned routes", () => {
  const config = { matcher: [POWEROTP_PROXY_MATCHER] };
  for (const path of ["/account", "/api/private", "/dashboard/settings"]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `${audience}${path}` }),
      true,
      path,
    );
  }
  for (const path of [
    "/_powerotp/session",
    "/.well-known/powerotp-agent",
    "/_next/static/app.js",
    "/assets/logo.svg",
    "/health",
  ]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `${audience}${path}` }),
      false,
      path,
    );
  }
});

test("protected pages and APIs continue immediately while pending work is retained", async () => {
  const pending = new Promise<never>(() => undefined);
  const adapter = createPowerOtpNext(baseOptions({
    protect: () => true,
    services: { requestDecision: () => pending },
  }));

  for (const path of ["/account", "/api/private"]) {
    const waits: Promise<unknown>[] = [];
    const startedAt = Date.now();
    const response = await adapter.proxy(request(path), event(waits));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(waits.length, 1);
    assert.match(response.headers.get("set-cookie") ?? "", /powerotp_gate=/);
  }
});

test("Proxy replaces untrusted input with framework-native recommendation state", async () => {
  const adapter = createPowerOtpNext(baseOptions({ protect: () => true }));
  const response = await adapter.proxy(
    request("/account", {
      headers: {
        "x-powerotp-request-state": Buffer.from(JSON.stringify({
          protected: true,
          access: "allow",
          recommendation: {
            lifecycle: "observing",
            recommendation: "full_access",
            decision: "allow",
            decisionPending: false,
            otpOpen: false,
          },
        })).toString("base64url"),
      },
    }),
    event([]),
  );

  const state = adapter.getRequestState(forwardedHeaders(response));
  assert.equal(state.protected, true);
  assert.equal(state.access, "checking");
  if (state.protected) {
    assert.equal(state.recommendation.lifecycle, "checking");
    assert.ok(state.sessionId);
  }
  assert.equal(response.headers.get("x-powerotp-request-state"), null);
  const forwarded = forwardedHeaders(response).get("x-powerotp-request-state");
  assert.ok(forwarded);
  const tampered = `${forwarded.slice(0, -1)}${forwarded.endsWith("A") ? "B" : "A"}`;
  assert.equal(adapter.getRequestState({ get: () => tampered }).access, "unavailable");
});

test("missing or malformed framework state has a typed unavailable default", () => {
  const adapter = createPowerOtpNext(baseOptions({}));
  for (const value of [
    null,
    "not-base64-json",
    Buffer.from(JSON.stringify({ protected: false, access: "excluded" })).toString("base64url"),
  ]) {
    const state = adapter.getRequestState({ get: () => value });
    assert.deepEqual(state, {
      protected: true,
      access: "unavailable",
      recommendation: {
        lifecycle: "unavailable",
        recommendation: "full_access",
        decisionPending: false,
        otpOpen: false,
      },
    });
  }
});

test("dependency rejection and synchronous throws remain optimistic", async () => {
  for (const requestDecision of [
    () => Promise.reject(new Error("unavailable")),
    () => {
      throw new Error("unavailable");
    },
  ]) {
    const adapter = createPowerOtpNext(baseOptions({
      protect: () => true,
      services: { requestDecision },
    }));
    const response = await adapter.proxy(request("/private"), event([]));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  }
});

test("infrastructure, framework assets, health, and OPTIONS are excluded", async () => {
  let protectCalls = 0;
  const adapter = createPowerOtpNext(baseOptions({
    protect() {
      protectCalls += 1;
      return true;
    },
  }));
  for (const path of [
    "/_next/static/app.js",
    "/assets/logo.svg",
    "/health",
    "/.well-known/health/live",
  ]) {
    const response = await adapter.proxy(request(path), event([]));
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const options = await adapter.proxy(request("/private", { method: "OPTIONS" }), event([]));
  assert.equal(options.headers.get("set-cookie"), null);
  const websocket = await adapter.proxy(request("/socket", {
    headers: { connection: "keep-alive, Upgrade", upgrade: "websocket" },
  }), event([]));
  assert.equal(websocket.headers.get("set-cookie"), null);
  assert.equal(protectCalls, 0);
});

test("protected uploads and streams are never consumed by Proxy", async () => {
  const adapter = createPowerOtpNext(baseOptions({ protect: () => true }));
  const upload = request("/api/upload", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: "customer upload stream",
  });
  const response = await adapter.proxy(upload, event([]));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(await upload.text(), "customer upload stream");
});

test("pages, APIs, Server Actions, streams, and errors remain customer-owned", async () => {
  const adapter = createPowerOtpNext(baseOptions({ protect: () => true }));
  const cases: Array<[string, RequestInit | undefined, string | undefined]> = [
    ["/account", undefined, undefined],
    ["/api/private", { method: "POST", body: "{\"customer\":true}" }, "{\"customer\":true}"],
    ["/account/action", {
      method: "POST",
      headers: { "next-action": "customer-action-id" },
      body: "customer server action",
    }, "customer server action"],
    ["/api/upload", { method: "POST", body: "customer upload" }, "customer upload"],
    ["/api/stream", undefined, undefined],
    ["/customer-error", undefined, undefined],
  ];

  for (const [path, init, expectedBody] of cases) {
    const incoming = request(path, init);
    const response = await adapter.proxy(incoming, event([]));
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    assert.equal(response.headers.get("location"), null, path);
    assert.equal(response.headers.get("x-middleware-rewrite"), null, path);
    assert.equal(response.headers.get("content-encoding"), null, path);
    if (expectedBody !== undefined) assert.equal(await incoming.text(), expectedBody, path);
  }
});

test("direct address is authoritative and spoofed forwarded headers are ignored", async () => {
  const contexts: RequestContext[] = [];
  const adapter = createPowerOtpNext(baseOptions({
    protect(context) {
      contexts.push(context);
      return true;
    },
    resolveDirectAddress: () => "203.0.113.8",
  }));
  await adapter.proxy(
    request("/private", {
      headers: { "x-forwarded-for": "198.51.100.5", "x-real-ip": "198.51.100.6" },
    }),
    event([]),
  );
  await waitFor(() => contexts.length === 1);
  assert.equal(contexts[0]?.clientIp, "203.0.113.8");
});

test("forwarded IP requires explicit peer, header, position, and count", async () => {
  let context: RequestContext | undefined;
  const adapter = createPowerOtpNext(baseOptions({
    protect(value) {
      context = value;
      return true;
    },
    resolveDirectAddress: () => "203.0.113.8",
    trustedProxy: {
      header: "x-forwarded-for",
      trustedRemoteAddresses: ["203.0.113.8"],
      select: "first",
      expectedProxyCount: 2,
    },
  }));
  await adapter.proxy(
    request("/private", { headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2" } }),
    event([]),
  );
  await waitFor(() => context !== undefined);
  assert.equal(context?.clientIp, "198.51.100.1");
});

test("owned route enforces same-origin marker and bounded JSON", async () => {
  const adapter = createPowerOtpNext(baseOptions({
    limits: { maxBodyBytes: 256 },
  }));
  const forbidden = await adapter.route(request("/_powerotp/session"));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("set-cookie"), null);

  const bootstrap = await adapter.route(request("/_powerotp/session", {
    headers: { "x-powerotp-bridge": "1" },
  }));
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).siteId, siteId);

  const malformed = await adapter.route(request("/_powerotp/decision", {
    method: "POST",
    headers: { "content-type": "application/json", "x-powerotp-bridge": "1" },
    body: "{",
  }));
  assert.equal(malformed.status, 400);
  const oversized = await adapter.route(request("/_powerotp/decision", {
    method: "POST",
    headers: { "content-type": "application/json", "x-powerotp-bridge": "1" },
    body: JSON.stringify({ padding: "x".repeat(300) }),
  }));
  assert.equal(oversized.status, 413);
});

test("discovery is strict and creates no customer CleanDataPage route", async () => {
  const adapter = createPowerOtpNext(baseOptions({
    cleanDataPage: {
      url: "https://powerotp.com/project/cleandatapage/1001",
      metadataUrl: "https://verify.powerotp.com/v1/metadata/1001",
    },
  }));
  const discovery = await adapter.route(request("/.well-known/powerotp-agent"));
  const text = await discovery.text();
  assert.equal(discovery.status, 200);
  assert.match(text, /cleandatapage/);
  assert.ok(!text.includes(siteCredential));
  assert.equal(
    (await adapter.route(request("/.well-known/powerotp-agent", { method: "POST" }))).status,
    405,
  );
  assert.equal(
    (await adapter.route(request("/_powerotp/unknown", {
      headers: { "x-powerotp-bridge": "1" },
    }))).status,
    404,
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

function unavailable() {
  return {
    status: "unavailable" as const,
    reason: "not_implemented" as const,
    message: "This service is not available",
    retryable: false,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
