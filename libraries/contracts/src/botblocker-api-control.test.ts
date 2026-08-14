import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CustomerVisitorSchema,
  CustomerVisitorsQuerySchema,
  OperatorBotBlockerHealthResponseSchema,
  OperatorDecisionTraceEntrySchema,
  OperatorPolicyPublicationRequestSchema,
  OperatorRapidListMutationSchema,
} from "./botblocker-api-control.js";

const SITE_ID = "site_0123456789abcdef";
const NOW = "2026-08-13T00:00:00.000Z";

describe("customer visitor contracts", () => {
  const visitor = {
    visitorId: "visitor_0123456789",
    siteId: SITE_ID,
    latestDecision: "allow",
    gateSessionCount: 2,
    behaviorReportCount: 4,
    firstObservedAt: NOW,
    lastObservedAt: "2026-08-13T00:01:00.000Z",
  };

  it("accepts a purpose-limited visitor summary", () => {
    assert.equal(CustomerVisitorSchema.safeParse(visitor).success, true);
    assert.equal(CustomerVisitorsQuerySchema.safeParse({}).success, true);
  });

  it("rejects raw intelligence, scores, and ownership claims", () => {
    for (const forbidden of [
      "customerId",
      "projectId",
      "ipHash",
      "fingerprintHash",
      "rawEvents",
      "score",
      "weights",
    ]) {
      assert.equal(
        CustomerVisitorSchema.safeParse({
          ...visitor,
          [forbidden]: "caller-value",
        }).success,
        false,
      );
    }
    assert.equal(
      CustomerVisitorsQuerySchema.safeParse({
        projectId: "project_012345678",
      }).success,
      false,
    );
  });
});

describe("operator contracts", () => {
  it("accepts rapid-list input without caller authority", () => {
    assert.equal(
      OperatorRapidListMutationSchema.safeParse({
        kind: "blacklist",
        indicatorKind: "asn",
        indicator: "AS64500",
        reason: "Confirmed abusive network",
        expiresAt: "2026-09-13T00:00:00.000Z",
      }).success,
      true,
    );
  });

  it("rejects caller signatures, scores, weights, ownership, and success", () => {
    const valid = {
      kind: "allow",
      indicatorKind: "ip_prefix",
      indicator: "192.0.2.0/24",
      reason: "Reviewed test network",
    };
    for (const forbidden of [
      "signature",
      "score",
      "weights",
      "customerId",
      "ownerId",
      "success",
      "unexpected",
    ]) {
      assert.equal(
        OperatorRapidListMutationSchema.safeParse({
          ...valid,
          [forbidden]: forbidden === "success" ? true : "caller-value",
        }).success,
        false,
      );
    }
  });

  it("keeps decision traces score-free", () => {
    const trace = {
      traceId: "trace_01234567890",
      gateSessionId: "gate_012345678901",
      stage: "rapid_auth",
      outcome: "otp",
      reasonCode: "policy_requires_challenge",
      occurredAt: NOW,
    };
    assert.equal(OperatorDecisionTraceEntrySchema.safeParse(trace).success, true);
    assert.equal(
      OperatorDecisionTraceEntrySchema.safeParse({
        ...trace,
        score: 95,
      }).success,
      false,
    );
  });

  it("accepts bounded operator health metadata", () => {
    assert.equal(
      OperatorBotBlockerHealthResponseSchema.safeParse({
        state: "degraded",
        checkedAt: NOW,
        dependencies: [
          { name: "policy-store", state: "healthy", checkedAt: NOW },
          { name: "risk-engine", state: "unavailable", checkedAt: NOW },
        ],
      }).success,
      true,
    );
  });

  it("reuses unsigned policy input and rejects a caller release signature", () => {
    const policy = {
      policyVersion: 1,
      protocolVersion: 1,
      siteId: SITE_ID,
      activatesAt: 1_786_000_000_000,
      expiresAt: 1_786_003_600_000,
      riskWeights: { modelVersion: "model-v1", payload: {} },
      challengeMapping: [],
      edgeEndpoints: [
        {
          region: "digitalocean",
          url: "https://verify.powerotp.com/v1/botblocker/rapid-auth",
        },
      ],
      sensorVersion: "sensor-v1",
      verificationKeys: [{ keyId: "key_active_1" }],
      datasetVersions: {},
      revocationFilter: {
        filterVersion: 1,
        checksumSha256: "a".repeat(64),
      },
    };
    assert.equal(
      OperatorPolicyPublicationRequestSchema.safeParse({ policy }).success,
      true,
    );
    assert.equal(
      OperatorPolicyPublicationRequestSchema.safeParse({
        policy,
        signature: "caller-signature",
      }).success,
      false,
    );
    assert.equal(
      OperatorPolicyPublicationRequestSchema.safeParse({
        policy: { ...policy, signature: "caller-signature" },
      }).success,
      false,
    );
  });
});
