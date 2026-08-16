import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumeBotBlockerNonce,
  type BotBlockerAtomicNonceStore,
  type BotBlockerNonceScope,
} from "./index.js";

const NOW = 1_786_000_000_000;
const scope: BotBlockerNonceScope = {
  artifactType: "site_clearance",
  siteId: "site_0123456789abcdef",
  audience: "https://customer.example",
  sessionId: "gate_session_0123456789",
};

class AtomicFakeStore implements BotBlockerAtomicNonceStore {
  readonly values = new Set<string>();

  async set(
    key: string,
    _value: string,
    _expiryMode: "PX",
    _ttlMs: number,
    _condition: "NX",
  ): Promise<"OK" | null> {
    if (this.values.has(key)) return null;
    this.values.add(key);
    return "OK";
  }
}

function consume(
  store: BotBlockerAtomicNonceStore,
  overrides: Partial<Parameters<typeof consumeBotBlockerNonce>[1]> = {},
) {
  return consumeBotBlockerNonce(store, {
    scope,
    nonce: "nonce_0123456789abcdef",
    expiresAt: NOW + 60_000,
    now: NOW,
    ...overrides,
  });
}

describe("Valkey-backed BotBlocker nonce consumption", () => {
  it("accepts the first use and rejects replay", async () => {
    const store = new AtomicFakeStore();

    assert.deepEqual(await consume(store), { ok: true });
    assert.deepEqual(await consume(store), {
      ok: false,
      code: "replay_detected",
    });
  });

  it("atomically allows only one concurrent consumer", async () => {
    const store = new AtomicFakeStore();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(store)),
    );

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(
      results.filter(
        (result) => !result.ok && result.code === "replay_detected",
      ).length,
      19,
    );
  });

  it("scopes identical nonces across sites and artifact types", async () => {
    const store = new AtomicFakeStore();

    assert.deepEqual(await consume(store), { ok: true });
    assert.deepEqual(
      await consume(store, {
        scope: { ...scope, siteId: "site_fedcba9876543210" },
      }),
      { ok: true },
    );
    assert.deepEqual(
      await consume(store, {
        scope: { ...scope, artifactType: "policy_release" },
      }),
      { ok: true },
    );
  });

  it("rejects expiry without writing and fails closed on storage errors", async () => {
    const store = new AtomicFakeStore();
    assert.deepEqual(
      await consume(store, { expiresAt: NOW }),
      { ok: false, code: "expired" },
    );
    assert.equal(store.values.size, 0);

    const unavailable: BotBlockerAtomicNonceStore = {
      async set() {
        throw new Error("Valkey unavailable");
      },
    };
    assert.deepEqual(await consume(unavailable), {
      ok: false,
      code: "storage_unavailable",
    });
  });
});
