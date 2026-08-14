import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PolicyReleaseRecord } from "./botblocker-policy-persistence.js";
import {
  BotBlockerPolicyResponseSchema,
  PolicyReleaseRecordSchema,
} from "./botblocker-policy-persistence.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "bbs_0123456789abcdef";

function record(): PolicyReleaseRecord {
  return {
    policyReleaseId: "bpr_0123456789abcdef",
    customerId: "usr_0123456789abcdef",
    projectId: "prj_0123456789abcdef",
    siteId: SITE_ID,
    policyVersion: 3,
    protocolVersion: 1,
    activatesAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    issuedAt: new Date(NOW).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    release: {
      signatureStatus: "signed",
      keyId: "key_0123456789abcdef",
      signature: "a".repeat(86),
      audience: SITE_ID,
      nonce: "nonce_0123456789abcdef",
      issuedAt: NOW,
      policy: {
        policyVersion: 3,
        protocolVersion: 1,
        siteId: SITE_ID,
        activatesAt: NOW,
        expiresAt: NOW + 3_600_000,
        riskWeights: { modelVersion: "model_contract", payload: {} },
        challengeMapping: [],
        edgeEndpoints: [],
        sensorVersion: "sensor_contract",
        verificationKeys: [{ keyId: "key_0123456789abcdef" }],
        datasetVersions: {},
        revocationFilter: {
          filterVersion: 1,
          checksumSha256: "a".repeat(64),
        },
      },
    },
  };
}

describe("policy release persistence contracts", () => {
  it("accepts a fully scoped immutable signed release", () => {
    assert.equal(PolicyReleaseRecordSchema.safeParse(record()).success, true);
  });

  it("rejects missing ownership scope and unknown fields", () => {
    const { customerId: _customerId, ...missingScope } = record();
    assert.equal(PolicyReleaseRecordSchema.safeParse(missingScope).success, false);
    assert.equal(
      PolicyReleaseRecordSchema.safeParse({ ...record(), mutableStatus: "active" }).success,
      false,
    );
  });

  it("rejects query metadata that disagrees with signed authority", () => {
    assert.equal(
      PolicyReleaseRecordSchema.safeParse({ ...record(), policyVersion: 2 }).success,
      false,
    );
    assert.equal(
      PolicyReleaseRecordSchema.safeParse({
        ...record(),
        release: { ...record().release, audience: "bbs_wrong_audience_123" },
      }).success,
      false,
    );
    assert.equal(
      PolicyReleaseRecordSchema.safeParse({
        ...record(),
        release: {
          ...record().release,
          policy: { ...record().release.policy, siteId: "bbs_wrong_site_12345" },
        },
      }).success,
      false,
    );
  });

  it("delivers only the signed release and bounded UX timeout", () => {
    assert.equal(
      BotBlockerPolicyResponseSchema.safeParse({
        release: record().release,
        decisionTimeoutMs: 200,
      }).success,
      true,
    );
    assert.equal(
      BotBlockerPolicyResponseSchema.safeParse({
        release: record().release,
        decisionTimeoutMs: 2_001,
      }).success,
      false,
    );
  });
});
