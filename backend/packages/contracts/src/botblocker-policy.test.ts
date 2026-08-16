import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type BotBlockerPolicy,
  BotBlockerPolicySchema,
  isPolicyVersionRegression,
  type PolicyKeyReference,
  SignedBotBlockerPolicyReleaseSchema,
} from "./botblocker-policy.js";

function validPolicy(): BotBlockerPolicy {
  const now = Date.now();
  return {
    policyVersion: 3,
    protocolVersion: 1,
    siteId: "site_0123456789abcdef",
    activatesAt: now,
    expiresAt: now + 3_600_000,
    riskWeights: { modelVersion: "model_v0", payload: {} },
    challengeMapping: [{ riskBand: "elevated", challengeKind: "interaction_puzzle" }],
    edgeEndpoints: [{ region: "nyc3", url: "https://edge-nyc3.powerotp.com" }],
    sensorVersion: "sensor_v1",
    verificationKeys: [{ keyId: "key_0000000000000001" }],
    datasetVersions: { blacklist: "2026-08-01" },
    revocationFilter: {
      filterVersion: 1,
      checksumSha256: "a".repeat(64),
    },
  };
}

describe("BotBlockerPolicySchema", () => {
  it("accepts a fully populated policy", () => {
    assert.equal(BotBlockerPolicySchema.safeParse(validPolicy()).success, true);
  });

  it("rejects expiresAt at or before activatesAt", () => {
    const now = Date.now();
    const policy = { ...validPolicy(), activatesAt: now, expiresAt: now };
    assert.equal(BotBlockerPolicySchema.safeParse(policy).success, false);
  });

  it("rejects a protocol version this contracts module doesn't recognize", () => {
    const policy = { ...validPolicy(), protocolVersion: 2 };
    assert.equal(BotBlockerPolicySchema.safeParse(policy).success, false);
  });

  it("rejects an empty verificationKeys array", () => {
    const policy = { ...validPolicy(), verificationKeys: [] };
    assert.equal(BotBlockerPolicySchema.safeParse(policy).success, false);
  });

  it("rejects a verification key entry carrying key material instead of an opaque id (and cannot be assigned at compile time)", () => {
    const valid = validPolicy();

    // @ts-expect-error -- a policy verification key must be an opaque key-id reference only, never key material.
    const forgedKeyRef: PolicyKeyReference = { keyId: "key_0000000000000001", publicKey: "MCowBQYDK2VwAyEA..." };
    const policy = { ...valid, verificationKeys: [forgedKeyRef] };

    assert.equal(BotBlockerPolicySchema.safeParse(policy).success, false);
  });

  it("rejects a policy carrying a fabricated signature field (and cannot be assigned at compile time)", () => {
    const valid = validPolicy();

    // @ts-expect-error -- no Ed25519 signature exists until Phase 3; this payload shape must never carry one.
    const withSignature: BotBlockerPolicy = { ...valid, signature: "forged-signature" };

    assert.equal(BotBlockerPolicySchema.safeParse(withSignature).success, false);
  });
});

describe("SignedBotBlockerPolicyReleaseSchema", () => {
  it("accepts a signed envelope around the unchanged policy payload", () => {
    const policy = validPolicy();
    assert.equal(
      SignedBotBlockerPolicyReleaseSchema.safeParse({
        signatureStatus: "signed",
        keyId: "key_0000000000000001",
        signature: "A".repeat(86),
        audience: "https://customer.example",
        nonce: "nonce_0123456789abcdef",
        issuedAt: policy.activatesAt,
        policy,
      }).success,
      true,
    );
  });

  it("rejects issuance at or after policy expiry", () => {
    const policy = validPolicy();
    assert.equal(
      SignedBotBlockerPolicyReleaseSchema.safeParse({
        signatureStatus: "signed",
        keyId: "key_0000000000000001",
        signature: "A".repeat(86),
        audience: "https://customer.example",
        nonce: "nonce_0123456789abcdef",
        issuedAt: policy.expiresAt,
        policy,
      }).success,
      false,
    );
  });
});

describe("isPolicyVersionRegression", () => {
  const active = { policyVersion: 5 };

  it("treats a strictly newer version as not a regression", () => {
    assert.equal(isPolicyVersionRegression({ policyVersion: 6 }, active), false);
  });

  it("treats an equal version (replay) as a regression", () => {
    assert.equal(isPolicyVersionRegression({ policyVersion: 5 }, active), true);
  });

  it("treats an older version as a regression", () => {
    assert.equal(isPolicyVersionRegression({ policyVersion: 4 }, active), true);
  });

  it("treats nothing as currently active as never a regression", () => {
    assert.equal(isPolicyVersionRegression({ policyVersion: 1 }, undefined), false);
  });
});
