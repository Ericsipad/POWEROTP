import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentEntitlementRequestSchema,
  BotBlockerCredentialRotationResponseSchema,
  BotBlockerRuntimeRequestEnvelopeSchema,
  BrowserAssessmentRequestSchema,
  CompleteChallengeRequestSchema,
  CreateChallengeRequestSchema,
  PaidTokenPassAssertionRequestSchema,
  PassportAssertionRequestSchema,
  PassportRegistrationRequestSchema,
  RapidAuthRequestSchema,
  ReadChallengeRequestSchema,
  RiskEventsRequestSchema,
} from "./botblocker-api-runtime.js";

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

describe("Phase 8 runtime route contracts", () => {
  it("accepts each runtime route payload in the common envelope", () => {
    const cases: Array<[unknown, { safeParse(value: unknown): { success: boolean } }]> = [
      [
        {
          ...base,
          payload: {
            gateSessionId: GATE_ID,
            request: { siteId: SITE_ID, method: "GET", path: "/" },
            browser,
          },
        },
        RapidAuthRequestSchema,
      ],
      [
        {
          ...base,
          payload: {
            report: { protocolVersion: 1, trigger: "initial", sequence, evidence },
          },
        },
        BrowserAssessmentRequestSchema,
      ],
      [
        {
          ...base,
          payload: {
            batch: {
              protocolVersion: 1,
              siteId: SITE_ID,
              sequence,
              events: [{ kind: "velocity_anomaly", occurredAt: NOW }],
            },
          },
        },
        RiskEventsRequestSchema,
      ],
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

  it("requires every common authentication binding", () => {
    for (const field of [
      "protocolVersion",
      "siteId",
      "gateSessionId",
      "audience",
      "nonce",
      "issuedAt",
    ] as const) {
      const request: Record<string, unknown> = { ...base, payload: {} };
      delete request[field];
      assert.equal(
        BotBlockerRuntimeRequestEnvelopeSchema.safeParse(request).success,
        false,
      );
    }
  });

  it("rejects mismatched nested protocol and site scope", () => {
    assert.equal(
      RapidAuthRequestSchema.safeParse({
        ...base,
        payload: {
          gateSessionId: GATE_ID,
          browser,
          request: {
            siteId: "site_other_012345678",
            method: "GET",
            path: "/",
          },
        },
      }).success,
      false,
    );
    assert.equal(
      RiskEventsRequestSchema.safeParse({
        ...base,
        payload: {
          batch: {
            protocolVersion: 1,
            siteId: "site_other_012345678",
            sequence,
            events: [{ kind: "velocity_anomaly", occurredAt: NOW }],
          },
        },
      }).success,
      false,
    );
    assert.equal(
      PassportAssertionRequestSchema.safeParse({
        ...base,
        payload: { ...passport, audience: "https://attacker.example" },
      }).success,
      false,
    );
    assert.equal(
      PaidTokenPassAssertionRequestSchema.safeParse({
        ...base,
        payload: { ...paidPass, siteId: "site_other_012345678" },
      }).success,
      false,
    );
  });

  it("rejects caller authority and unknown fields", () => {
    for (const forbidden of [
      "signature",
      "score",
      "weights",
      "ownerId",
      "success",
      "unexpected",
    ]) {
      assert.equal(
        CreateChallengeRequestSchema.safeParse({
          ...base,
          payload: { gateSessionId: GATE_ID },
          [forbidden]: forbidden === "success" ? true : "caller-value",
        }).success,
        false,
      );
      assert.equal(
        CreateChallengeRequestSchema.safeParse({
          ...base,
          payload: {
            gateSessionId: GATE_ID,
            [forbidden]: forbidden === "success" ? true : "caller-value",
          },
        }).success,
        false,
      );
    }
  });

  it("rejects invented proof and entitlement success", () => {
    assert.equal(
      PassportAssertionRequestSchema.safeParse({
        ...base,
        payload: { ...passport, verified: true },
      }).success,
      false,
    );
    assert.equal(
      AgentEntitlementRequestSchema.safeParse({
        ...base,
        payload: {
          gateSessionId: GATE_ID,
          paidTokenPass: paidPass,
          entitled: true,
        },
      }).success,
      false,
    );
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
    assert.equal(
      BotBlockerCredentialRotationResponseSchema.safeParse({
        ...response,
        credentialHash: "secret",
      }).success,
      false,
    );
  });
});
