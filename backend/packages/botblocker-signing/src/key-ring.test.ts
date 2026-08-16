import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import type { UnsignedSiteClearance } from "@powerotp/contracts";

import {
  loadBotBlockerKeyRing,
  signSiteClearance,
  verifySiteClearance,
  type BotBlockerActiveSigningKey,
  type BotBlockerVerificationKeySet,
} from "./index.js";

const NOW = 1_786_000_000_000;
const ACTIVE_ID = "key_active_00000001";
const PREVIOUS_ID = "key_previous_000001";

function keys() {
  return generateKeyPairSync("ed25519");
}

function clearance(
  overrides: Partial<UnsignedSiteClearance> = {},
): UnsignedSiteClearance {
  return {
    signatureStatus: "unsigned",
    siteId: "site_0123456789abcdef",
    gateSessionId: "gate_session_0123456789",
    audience: "https://customer.example",
    nonce: "nonce_0123456789abcdef",
    issuedAt: NOW,
    expiresAt: NOW + 180_000,
    ...overrides,
  };
}

function verify(
  signed: unknown,
  verificationKeys: BotBlockerVerificationKeySet,
  now = NOW,
  clockSkewMs?: number,
) {
  return verifySiteClearance({
    clearance: signed,
    verificationKeys,
    expectedAudience: "https://customer.example",
    expectedSiteId: "site_0123456789abcdef",
    expectedGateSessionId: "gate_session_0123456789",
    now,
    clockSkewMs,
  });
}

describe("BotBlocker key lifecycle", () => {
  it("signs with active and verifies active and previous keys during overlap", () => {
    const active = keys();
    const previous = keys();
    const keySet: BotBlockerVerificationKeySet = {
      active: { keyId: ACTIVE_ID, publicKey: active.publicKey },
      previous: {
        keyId: PREVIOUS_ID,
        publicKey: previous.publicKey,
        verifyUntil: NOW + 60_000,
      },
    };
    const activeArtifact = signSiteClearance(clearance(), {
      keyId: ACTIVE_ID,
      privateKey: active.privateKey,
    });
    const previousArtifact = signSiteClearance(clearance(), {
      keyId: PREVIOUS_ID,
      privateKey: previous.privateKey,
    });

    assert.equal(verify(activeArtifact, keySet).ok, true);
    assert.equal(verify(previousArtifact, keySet, NOW + 59_999).ok, true);
  });

  it("retires the previous key at the exact overlap boundary", () => {
    const active = keys();
    const previous = keys();
    const keySet: BotBlockerVerificationKeySet = {
      active: { keyId: ACTIVE_ID, publicKey: active.publicKey },
      previous: {
        keyId: PREVIOUS_ID,
        publicKey: previous.publicKey,
        verifyUntil: NOW + 60_000,
      },
    };
    const artifact = signSiteClearance(clearance(), {
      keyId: PREVIOUS_ID,
      privateKey: previous.privateKey,
    });
    const result = verify(artifact, keySet, NOW + 60_000);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /retired/);
  });

  it("revocation immediately overrides active and previous trust", () => {
    const active = keys();
    const previous = keys();
    const keySet: BotBlockerVerificationKeySet = {
      active: { keyId: ACTIVE_ID, publicKey: active.publicKey },
      previous: {
        keyId: PREVIOUS_ID,
        publicKey: previous.publicKey,
        verifyUntil: NOW + 60_000,
      },
      revokedKeyIds: new Set([PREVIOUS_ID]),
    };
    const artifact = signSiteClearance(clearance(), {
      keyId: PREVIOUS_ID,
      privateKey: previous.privateKey,
    });
    const result = verify(artifact, keySet);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /revoked/);
  });
});

describe("BotBlocker key configuration", () => {
  it("imports canonical DER keys and exposes only public verification keys", () => {
    const active = keys();
    const previous = keys();
    const ring = loadBotBlockerKeyRing({
      activeKeyId: ACTIVE_ID,
      activePrivateKeyPkcs8Base64: active.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      previousKeyId: PREVIOUS_ID,
      previousPublicKeySpkiBase64: previous.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      previousVerifyUntil: NOW + 60_000,
      clockSkewMs: 1_000,
    });

    assert.equal(ring.activeSigningKey.keyId, ACTIVE_ID);
    assert.equal(ring.verificationKeys.previous?.keyId, PREVIOUS_ID);
    assert.equal("privateKey" in ring.verificationKeys.active, false);
    assert.equal(ring.clockSkewMs, 1_000);
  });

  it("rejects incomplete previous configuration, active revocation, and excessive skew", () => {
    const active = keys();
    const base = {
      activeKeyId: ACTIVE_ID,
      activePrivateKeyPkcs8Base64: active.privateKey
        .export({ format: "der", type: "pkcs8" as const })
        .toString("base64"),
    };

    assert.throws(
      () => loadBotBlockerKeyRing({ ...base, previousKeyId: PREVIOUS_ID }),
      /configured together/,
    );
    assert.throws(
      () => loadBotBlockerKeyRing({ ...base, revokedKeyIds: [ACTIVE_ID] }),
      /cannot be revoked/,
    );
    assert.throws(
      () => loadBotBlockerKeyRing({ ...base, clockSkewMs: 300_001 }),
      /clock skew/,
    );
  });
});

describe("BotBlocker clock-skew boundaries", () => {
  it("accepts the configured boundary and rejects one millisecond beyond it", () => {
    const pair = keys();
    const signingKey: BotBlockerActiveSigningKey = {
      keyId: ACTIVE_ID,
      privateKey: pair.privateKey,
    };
    const keySet: BotBlockerVerificationKeySet = {
      active: { keyId: ACTIVE_ID, publicKey: pair.publicKey },
    };
    const atBoundary = signSiteClearance(
      clearance({ issuedAt: NOW + 1_000, expiresAt: NOW + 180_000 }),
      signingKey,
    );
    const beyondBoundary = signSiteClearance(
      clearance({ issuedAt: NOW + 1_001, expiresAt: NOW + 180_000 }),
      signingKey,
    );

    assert.equal(verify(atBoundary, keySet, NOW, 1_000).ok, true);
    assert.equal(verify(beyondBoundary, keySet, NOW, 1_000).ok, false);
  });

  it("preserves zero implicit skew and expires at the skew-adjusted boundary", () => {
    const pair = keys();
    const keySet: BotBlockerVerificationKeySet = {
      active: { keyId: ACTIVE_ID, publicKey: pair.publicKey },
    };
    const artifact = signSiteClearance(clearance(), {
      keyId: ACTIVE_ID,
      privateKey: pair.privateKey,
    });

    assert.equal(verify(artifact, keySet, artifact.expiresAt).ok, false);
    assert.equal(verify(artifact, keySet, artifact.expiresAt + 999, 1_000).ok, true);
    assert.equal(verify(artifact, keySet, artifact.expiresAt + 1_000, 1_000).ok, false);
  });
});
