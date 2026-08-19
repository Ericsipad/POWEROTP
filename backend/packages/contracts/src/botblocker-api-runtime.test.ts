import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentEntitlementRequestSchema,
  BotBlockerCredentialRotationResponseSchema,
  BotBlockerRuntimeRequestEnvelopeSchema,
  CanonicalReportRequestSchema,
  CompleteChallengeRequestSchema,
  CreateChallengeRequestSchema,
  PaidTokenPassAssertionRequestSchema,
  PassportAssertionRequestSchema,
  PassportRegistrationRequestSchema,
  ReadChallengeRequestSchema,
} from "./botblocker-api-runtime.js";
import {
  FINGERPRINT_COLLECTOR_VERSION,
  FINGERPRINT_VECTOR_VERSION,
} from "./fingerprint.js";
import { fingerprintComponentNames } from "./fingerprint-components.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "site_0123456789abcdef";
const GATE_ID = "gate_0123456789abcdef";
const base = {
  protocolVersion: 1,
  siteId: SITE_ID,
  gateSessionId: GATE_ID,
  audience: "https://customer.example",
  nonce: "nonce_0123456789abcdef",
  issuedAt: NOW,
};
const sequence = { gateSessionId: GATE_ID, sequence: 1, issuedAt: NOW };
const evidence = {
  routePath: "/checkout",
  clicks: [],
  mouseDirectness: { averageDirectnessRatio: 0.7, sampleCount: 2 },
  scroll: { smoothnessScore: 0.8, highSpeedEventCount: 0 },
  honeypotActivations: [],
};
const browser = { protocolVersion: 1, evidence, proofs: {} };
const fingerprint = {
  fingerprintVersion: FINGERPRINT_VECTOR_VERSION,
  collectorVersion: FINGERPRINT_COLLECTOR_VERSION,
  components: Object.fromEntries(
    fingerprintComponentNames.map((name) => [name, { status: "unavailable" }]),
  ),
};
const passport = {
  assertionId: "assertion_0123456789",
  siteId: SITE_ID,
  pairwiseSubjectId: "subject_01234567890",
  audience: base.audience,
  nonce: "proof_nonce_0123456789",
  issuedAt: NOW,
  expiresAt: NOW + 60_000,
};
const paidPass = {
  assertionId: "assertion_paid_012345",
  siteId: SITE_ID,
  passId: "paid_pass_012345678",
  scope: "one_time",
  audience: base.audience,
  nonce: "pass_nonce_0123456789",
  issuedAt: NOW,
  expiresAt: NOW + 60_000,
};

describe("canonical runtime report contract", () => {
  it("uses one shape for first contact and later updates", () => {
    assert.equal(CanonicalReportRequestSchema.safeParse({
      ...base,
      reportSequence: -1,
      payload: {
        request: { siteId: SITE_ID, method: "GET", path: "/" },
        browserEvidence: browser.evidence,
        fingerprint,
        proofs: browser.proofs,
      },
    }).success, true);
    assert.equal(CanonicalReportRequestSchema.safeParse({
      ...base,
      reportSequence: 1,
      payload: {
        behaviorReport: {
          protocolVersion: 1,
          trigger: "recurring",
          sequence,
          evidence,
        },
        riskSignals: [{ kind: "velocity_anomaly", occurredAt: NOW }],
      },
    }).success, true);
  });

  it("allows every evidence category to be omitted", () => {
    assert.equal(CanonicalReportRequestSchema.safeParse({
      ...base,
      reportSequence: 2,
      payload: {},
    }).success, true);
  });

  it("requires closed scope, order, freshness, and authentication bindings", () => {
    for (const field of [
      "protocolVersion",
      "siteId",
      "gateSessionId",
      "audience",
      "reportSequence",
      "nonce",
      "issuedAt",
    ] as const) {
      const request: Record<string, unknown> = {
        ...base,
        reportSequence: 1,
        payload: {},
      };
      delete request[field];
      assert.equal(CanonicalReportRequestSchema.safeParse(request).success, false);
    }
  });

  it("rejects mismatched nested scope/order and caller authority", () => {
    assert.equal(CanonicalReportRequestSchema.safeParse({
      ...base,
      reportSequence: 1,
      payload: {
        behaviorReport: {
          protocolVersion: 1,
          trigger: "recurring",
          sequence: { ...sequence, sequence: 2 },
          evidence,
        },
      },
    }).success, false);
    assert.equal(CanonicalReportRequestSchema.safeParse({
      ...base,
      reportSequence: -1,
      payload: {
        request: {
          siteId: "site_other_012345678",
          method: "GET",
          path: "/",
        },
      },
    }).success, false);
    for (const forbidden of ["signature", "score", "weights", "decision"]) {
      assert.equal(CanonicalReportRequestSchema.safeParse({
        ...base,
        reportSequence: 1,
        payload: { [forbidden]: "caller-value" },
      }).success, false);
    }
  });
});

describe("other runtime route contracts", () => {
  it("accepts challenge, Passport, paid-pass, and entitlement envelopes", () => {
    const cases: Array<[unknown, { safeParse(value: unknown): { success: boolean } }]> = [
      [{ ...base, payload: { gateSessionId: GATE_ID } }, CreateChallengeRequestSchema],
      [
        { ...base, payload: { challengeId: "challenge_012345678" } },
        ReadChallengeRequestSchema,
      ],
      [
        {
          ...base,
          payload: {
            challengeId: "challenge_012345678",
            selectedOptionIds: ["option_012345678901"],
          },
        },
        CompleteChallengeRequestSchema,
      ],
      [
        {
          ...base,
          payload: {
            gateSessionId: GATE_ID,
            credentialId: "credential_012345678",
            publicKey: { kty: "OKP", crv: "Ed25519", x: "A".repeat(43) },
          },
        },
        PassportRegistrationRequestSchema,
      ],
      [{ ...base, payload: passport }, PassportAssertionRequestSchema],
      [{ ...base, payload: paidPass }, PaidTokenPassAssertionRequestSchema],
      [
        {
          ...base,
          payload: { gateSessionId: GATE_ID, paidTokenPass: paidPass },
        },
        AgentEntitlementRequestSchema,
      ],
    ];
    for (const [value, schema] of cases) {
      assert.equal(schema.safeParse(value).success, true);
    }
  });

  it("keeps the generic runtime envelope closed", () => {
    assert.equal(BotBlockerRuntimeRequestEnvelopeSchema.safeParse({
      ...base,
      payload: {},
      score: 100,
    }).success, false);
  });
});

describe("credential rotation response", () => {
  it("accepts only the one-time value and safe metadata", () => {
    const response = {
      value: `potp_bb_${"x".repeat(43)}`,
      prefix: "potp_bb_xxxx",
      lastFour: "xxxx",
      createdAt: "2026-08-13T00:00:00.000Z",
    };
    assert.equal(
      BotBlockerCredentialRotationResponseSchema.safeParse(response).success,
      true,
    );
    assert.equal(BotBlockerCredentialRotationResponseSchema.safeParse({
      ...response,
      credentialHash: "secret",
    }).success, false);
  });
});
