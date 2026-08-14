import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import type {
  BotBlockerPolicy,
  UnsignedSiteClearance,
} from "@powerotp/contracts";

import {
  signBotBlockerPolicyRelease,
  signSiteClearance,
  verifyBotBlockerPolicyRelease,
  verifySiteClearance,
} from "./index.js";

const NOW = 1_786_000_000_000;
const KEY_ID = "key_0000000000000001";

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

function policy(): BotBlockerPolicy {
  return {
    policyVersion: 3,
    protocolVersion: 1,
    siteId: "site_0123456789abcdef",
    activatesAt: NOW,
    expiresAt: NOW + 3_600_000,
    riskWeights: { modelVersion: "model_v0", payload: { alpha: 1, beta: 2 } },
    challengeMapping: [
      { riskBand: "elevated", challengeKind: "interaction_puzzle" },
    ],
    edgeEndpoints: [{ region: "nyc3", url: "https://edge-nyc3.powerotp.com" }],
    sensorVersion: "sensor_v1",
    verificationKeys: [{ keyId: KEY_ID }],
    datasetVersions: { blacklist: "2026-08-01" },
    revocationFilter: {
      filterVersion: 1,
      checksumSha256: "a".repeat(64),
    },
  };
}

function verifyClearance(
  signed: unknown,
  publicKey: ReturnType<typeof keys>["publicKey"],
  now = NOW,
) {
  return verifySiteClearance({
    clearance: signed,
    publicKeys: { [KEY_ID]: publicKey },
    expectedAudience: "https://customer.example",
    expectedSiteId: "site_0123456789abcdef",
    expectedGateSessionId: "gate_session_0123456789",
    now,
  });
}

describe("site clearance Ed25519 signing", () => {
  it("signs and verifies a correctly bound clearance", () => {
    const { privateKey, publicKey } = keys();
    const signed = signSiteClearance(clearance(), KEY_ID, privateKey);

    assert.equal(verifyClearance(signed, publicKey).ok, true);
  });

  it("rejects forgery and malformed signatures", () => {
    const { privateKey, publicKey } = keys();
    const signed = signSiteClearance(clearance(), KEY_ID, privateKey);

    const tampered = { ...signed, nonce: "nonce_forged_1234567890" };
    const forgedResult = verifyClearance(tampered, publicKey);
    assert.equal(forgedResult.ok, false);
    if (!forgedResult.ok) assert.equal(forgedResult.code, "invalid_signature");

    const malformedResult = verifyClearance({ ...signed, signature: "not-base64" }, publicKey);
    assert.equal(malformedResult.ok, false);
    if (!malformedResult.ok) assert.equal(malformedResult.code, "invalid_signature");
  });

  it("rejects audience, site, and session mismatches", () => {
    const { privateKey, publicKey } = keys();
    const signed = signSiteClearance(clearance(), KEY_ID, privateKey);

    const audience = verifySiteClearance({
      clearance: signed,
      publicKeys: { [KEY_ID]: publicKey },
      expectedAudience: "https://other.example",
      expectedSiteId: signed.siteId,
      expectedGateSessionId: signed.gateSessionId,
      now: NOW,
    });
    assert.equal(audience.ok, false);
    if (!audience.ok) assert.equal(audience.code, "audience_mismatch");

    const site = verifySiteClearance({
      clearance: signed,
      publicKeys: { [KEY_ID]: publicKey },
      expectedAudience: signed.audience,
      expectedSiteId: "site_fedcba9876543210",
      expectedGateSessionId: signed.gateSessionId,
      now: NOW,
    });
    assert.equal(site.ok, false);

    const session = verifySiteClearance({
      clearance: signed,
      publicKeys: { [KEY_ID]: publicKey },
      expectedAudience: signed.audience,
      expectedSiteId: signed.siteId,
      expectedGateSessionId: "gate_session_9876543210",
      now: NOW,
    });
    assert.equal(session.ok, false);
  });

  it("rejects expiry and issuance in the future", () => {
    const { privateKey, publicKey } = keys();
    const signed = signSiteClearance(clearance(), KEY_ID, privateKey);
    const expired = verifyClearance(signed, publicKey, signed.expiresAt);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.code, "expired");

    const future = signSiteClearance(
      clearance({ issuedAt: NOW + 1, expiresAt: NOW + 180_000 }),
      KEY_ID,
      privateKey,
    );
    const futureResult = verifyClearance(future, publicKey);
    assert.equal(futureResult.ok, false);
    if (!futureResult.ok) assert.equal(futureResult.code, "invalid_signature");
  });

  it("is deterministic and rejects a mismatched key", () => {
    const signer = keys();
    const other = keys();
    const first = signSiteClearance(clearance(), KEY_ID, signer.privateKey);
    const second = signSiteClearance(clearance(), KEY_ID, signer.privateKey);
    assert.equal(first.signature, second.signature);

    const mismatch = verifyClearance(first, other.publicKey);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "invalid_signature");
  });
});

describe("policy release Ed25519 signing", () => {
  it("round-trips and rejects policy tampering", () => {
    const { privateKey, publicKey } = keys();
    const release = signBotBlockerPolicyRelease({
      policy: policy(),
      keyId: KEY_ID,
      audience: "https://customer.example",
      nonce: "nonce_0123456789abcdef",
      issuedAt: NOW,
      privateKey,
    });
    const options = {
      publicKeys: { [KEY_ID]: publicKey },
      expectedAudience: release.audience,
      expectedSiteId: release.policy.siteId,
      now: NOW,
    };

    assert.equal(verifyBotBlockerPolicyRelease({ release, ...options }).ok, true);

    const tampered = {
      ...release,
      policy: { ...release.policy, sensorVersion: "forged_sensor" },
    };
    const result = verifyBotBlockerPolicyRelease({ release: tampered, ...options });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_signature");
  });

  it("rejects an unknown key id", () => {
    const { privateKey, publicKey } = keys();
    const release = signBotBlockerPolicyRelease({
      policy: policy(),
      keyId: KEY_ID,
      audience: "https://customer.example",
      nonce: "nonce_0123456789abcdef",
      issuedAt: NOW,
      privateKey,
    });
    const result = verifyBotBlockerPolicyRelease({
      release: { ...release, keyId: "key_unknown_00000001" },
      publicKeys: { [KEY_ID]: publicKey },
      expectedAudience: release.audience,
      expectedSiteId: release.policy.siteId,
      now: NOW,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_signature");
  });
});
