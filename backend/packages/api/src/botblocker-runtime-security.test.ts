import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Redis } from "ioredis";

import {
  BotBlockerRuntimeError,
  BotBlockerRuntimeSecurity,
} from "./botblocker-runtime-security.js";

const site = {
  customerId: "usr_owner",
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
  enabled: true,
  allowedOrigins: ["https://customer.example"],
};
const runtimeSite = {
  ...site,
  webhookId: "bwh_test",
  projectActive: true,
};
const now = 1_786_000_000_000;

function fixture(options: { storageFailure?: boolean } = {}) {
  const values = new Map<string, string>();
  const valkey = {
    set: async (key: string, value: string) => {
      if (options.storageFailure) throw new Error("Valkey unavailable");
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    get: async (key: string) => values.get(key) ?? null,
  } as unknown as Redis;
  const security = new BotBlockerRuntimeSecurity(
    { authenticate: async () => site },
    { verify: () => ({
      version: 1,
      projectId: site.projectId,
      siteId: site.siteId,
      gateSessionId: "gate_session_123456",
      audience: "https://customer.example",
      nonce: "visitor_nonce_123456",
      issuedAt: now - 1,
      expiresAt: now + 60_000,
    }) },
    valkey,
    { BOTBLOCKER_RUNTIME_ORIGIN: "https://verify.powerotp.com" },
  );
  return { security, values };
}

function request(overrides: Record<string, unknown> = {}) {
  const body = {
    siteId: site.siteId,
    gateSessionId: "gate_session_123456",
    audience: "https://customer.example",
    nonce: "nonce_1234567890123456",
    issuedAt: now,
    ...overrides,
  };
  return {
    authorizationHeader: "Bearer potp_bb_test",
    requestOrigin: "https://verify.powerotp.com",
    idempotencyKey: "idem_1234567890123456",
    operation: "rapid-auth",
    authentication: "site_credential" as const,
    runtimeSite,
    body,
    rawBody: body,
    now,
  };
}

describe("BotBlockerRuntimeSecurity", () => {
  it("binds authenticated mutations to site, origin, audience, time, idempotency, and nonce", async () => {
    const { security, values } = fixture();
    const authenticated = await security.authorizeMutation(request());
    assert.equal(authenticated.siteId, site.siteId);
    assert.equal(values.size, 2);
  });

  it("returns an idempotent retry before consuming the nonce again", async () => {
    const { security, values } = fixture();
    await security.authorizeMutation(request());
    await security.authorizeMutation(request());
    assert.equal(values.size, 2);
  });

  it("rejects idempotency conflicts and nonce replay under a new key", async () => {
    const { security } = fixture();
    await security.authorizeMutation(request());
    await assert.rejects(
      security.authorizeMutation(
        request({
          nonce: "nonce_different_123456",
          extra: "changes request hash",
        }),
      ),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "idempotency_key_conflict",
    );
    await assert.rejects(
      security.authorizeMutation({
        ...request(),
        idempotencyKey: "idem_different_123456",
      }),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "replay_detected",
    );
  });

  it("rejects wrong runtime origin, customer audience, site, and stale issuance", async () => {
    const cases = [
      { requestOrigin: "https://powerotp.com" },
      { body: request({ audience: "https://other.example" }).body },
      { body: request({ siteId: "bbs_other_1234567890123456" }).body },
      { body: request({ issuedAt: now - 300_001 }).body },
    ];
    for (const change of cases) {
      const { security } = fixture();
      await assert.rejects(
        security.authorizeMutation({ ...request(), ...change }),
        BotBlockerRuntimeError,
      );
    }
  });

  it("fails closed when replay storage is unavailable", async () => {
    const { security } = fixture({ storageFailure: true });
    await assert.rejects(
      security.authorizeMutation(request()),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "dependency_unavailable" &&
        error.unavailable,
    );
  });
});
