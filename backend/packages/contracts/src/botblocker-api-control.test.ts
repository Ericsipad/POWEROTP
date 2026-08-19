import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CustomerVisitorSchema,
  CustomerVisitorsQuerySchema,
  OperatorAsnClassificationEntrySchema,
  OperatorAsnClassificationMutationSchema,
  OperatorAsnClassificationQuerySchema,
  OperatorAsnTypeScoreEntrySchema,
  OperatorAsnTypeScoreMutationSchema,
  OperatorBotBlockerHealthResponseSchema,
  OperatorDecisionTraceEntrySchema,
  OperatorIpBlacklistEntrySchema,
  OperatorIpBlacklistMutationSchema,
  OperatorIpBlacklistQuerySchema,
  OperatorIpBlacklistRevokeRequestSchema,
  OperatorPolicyPublicationRequestSchema,
} from "./botblocker-api-control.js";

const SITE_ID = "site_0123456789abcdef";
const NOW = "2026-08-13T00:00:00.000Z";

describe("customer visitor contracts", () => {
  const visitor = {
    visitorId: "visitor_0123456789",
    siteId: SITE_ID,
    ip: "203.0.113.5",
    latestDecision: "allow",
    gateSessionCount: 2,
    behaviorReportCount: 4,
    pageViewCount: 4,
    totalPageDurationMs: 95_000,
    totalActiveDurationMs: 81_000,
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
      "passportUserId",
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

describe("operator IP blacklist contracts", () => {
  const mutation = {
    ip: "203.0.113.5",
    reason: "Confirmed scraper",
    provenance: "operator_manual",
  };

  it("accepts a v4 or v6 mutation and rejects a malformed IP", () => {
    assert.equal(OperatorIpBlacklistMutationSchema.safeParse(mutation).success, true);
    assert.equal(
      OperatorIpBlacklistMutationSchema.safeParse({
        ...mutation,
        ip: "2001:db8::1",
        provenance: "automatic_detection",
      }).success,
      true,
    );
    assert.equal(
      OperatorIpBlacklistMutationSchema.safeParse({
        ...mutation,
        ip: "not-an-ip",
      }).success,
      false,
    );
  });

  it("rejects caller-supplied identity, scores, or unknown fields", () => {
    for (const forbidden of ["entryId", "createdBy", "createdAt", "family", "score"]) {
      assert.equal(
        OperatorIpBlacklistMutationSchema.safeParse({
          ...mutation,
          [forbidden]: "caller-value",
        }).success,
        false,
      );
    }
  });

  it("requires a family for the list query", () => {
    assert.equal(OperatorIpBlacklistQuerySchema.safeParse({}).success, false);
    assert.equal(
      OperatorIpBlacklistQuerySchema.safeParse({ family: "v4" }).success,
      true,
    );
    assert.equal(
      OperatorIpBlacklistQuerySchema.safeParse({ family: "v8" }).success,
      false,
    );
  });

  it("accepts a full entry and rejects a caller-supplied score", () => {
    const entry = {
      entryId: "bl4_0123456789abcdef",
      family: "v4",
      ip: "203.0.113.5",
      reason: "Confirmed scraper",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin_1",
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(OperatorIpBlacklistEntrySchema.safeParse(entry).success, true);
    assert.equal(
      OperatorIpBlacklistEntrySchema.safeParse({ ...entry, score: 95 }).success,
      false,
    );
  });

  it("accepts a bare entryId revoke request only", () => {
    assert.equal(
      OperatorIpBlacklistRevokeRequestSchema.safeParse({
        entryId: "bl4_0123456789abcdef",
      }).success,
      true,
    );
    assert.equal(
      OperatorIpBlacklistRevokeRequestSchema.safeParse({
        entryId: "bl4_0123456789abcdef",
        reason: "unexpected",
      }).success,
      false,
    );
  });
});

describe("operator ASN classification contracts", () => {
  const mutation = {
    asn: 64500,
    asnType: "datacenter",
    classificationSource: "ai_research",
  };

  it("accepts a minimal classification and defaults are not implied by the schema", () => {
    assert.equal(OperatorAsnClassificationMutationSchema.safeParse(mutation).success, true);
    assert.equal(
      OperatorAsnClassificationMutationSchema.safeParse({
        ...mutation,
        asnOrg: "Example Hosting Org",
        notes: "Confirmed via WHOIS + provider ASN listing",
      }).success,
      true,
    );
  });

  it("rejects a non-numeric or non-positive ASN and an unknown type", () => {
    assert.equal(
      OperatorAsnClassificationMutationSchema.safeParse({ ...mutation, asn: "AS64500" }).success,
      false,
    );
    assert.equal(
      OperatorAsnClassificationMutationSchema.safeParse({ ...mutation, asn: -1 }).success,
      false,
    );
    assert.equal(
      OperatorAsnClassificationMutationSchema.safeParse({
        ...mutation,
        asnType: "residential_home",
      }).success,
      false,
    );
  });

  it("rejects caller-supplied identity or timestamps", () => {
    for (const forbidden of ["updatedBy", "createdAt", "updatedAt"]) {
      assert.equal(
        OperatorAsnClassificationMutationSchema.safeParse({
          ...mutation,
          [forbidden]: "caller-value",
        }).success,
        false,
      );
    }
  });

  it("requires every ASN type default to unclassified, never a fabricated type", () => {
    const entry = {
      asn: 64500,
      asnType: "unclassified",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin_1",
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(OperatorAsnClassificationEntrySchema.safeParse(entry).success, true);
  });

  it("accepts an optional asnType filter on the list query", () => {
    assert.equal(OperatorAsnClassificationQuerySchema.safeParse({}).success, true);
    assert.equal(
      OperatorAsnClassificationQuerySchema.safeParse({ asnType: "known_proxy" }).success,
      true,
    );
    assert.equal(
      OperatorAsnClassificationQuerySchema.safeParse({ asnType: "not-a-type" }).success,
      false,
    );
  });
});

describe("operator ASN type score contracts", () => {
  it("accepts an integer score and boolean API-lookup switch for every type", () => {
    for (const asnType of [
      "datacenter",
      "residential_isp",
      "isp_static",
      "known_proxy",
      "unclassified",
    ]) {
      assert.equal(
        OperatorAsnTypeScoreMutationSchema.safeParse({
          asnType,
          score: 25,
          requiresApiLookup: true,
        }).success,
        true,
      );
    }
  });

  it("rejects a non-integer score and an unknown type", () => {
    assert.equal(
      OperatorAsnTypeScoreMutationSchema.safeParse({
        asnType: "datacenter",
        score: 1.5,
        requiresApiLookup: false,
      }).success,
      false,
    );
    assert.equal(
      OperatorAsnTypeScoreMutationSchema.safeParse({
        asnType: "not-a-type",
        score: 0,
        requiresApiLookup: false,
      }).success,
      false,
    );
  });

  it("allows an entry with no persisted updatedBy/updatedAt (a synthesized default)", () => {
    assert.equal(
      OperatorAsnTypeScoreEntrySchema.safeParse({
        asnType: "unclassified",
        score: 0,
        requiresApiLookup: false,
      }).success,
      true,
    );
    assert.equal(
      OperatorAsnTypeScoreEntrySchema.safeParse({
        asnType: "unclassified",
        score: 0,
        requiresApiLookup: false,
        updatedBy: "usr_platform_admin_1",
        updatedAt: NOW,
      }).success,
      true,
    );
  });
});

describe("operator contracts", () => {
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
          url: "https://verify.powerotp.com/v1/botblocker/reports",
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
