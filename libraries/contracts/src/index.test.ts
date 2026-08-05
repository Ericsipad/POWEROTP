import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ChallengeSchema,
  CreateVerificationSchema,
  CustomerRegistrationSchema,
  InteractionTokenClaimsSchema,
  UpdateProjectSchema,
} from "./index.js";

describe("CreateVerificationSchema", () => {
  it("accepts a valid voice code request", () => {
    const result = CreateVerificationSchema.safeParse({
      type: "voice_code",
      targetNumber: "+15551234567",
      code: "12345",
    });

    assert.equal(result.success, true);
  });

  it("rejects non-E.164 destinations", () => {
    const result = CreateVerificationSchema.safeParse({
      type: "call_reachability",
      targetNumber: "555-123-4567",
    });

    assert.equal(result.success, false);
  });

  it("rejects codes for unrelated methods", () => {
    const result = CreateVerificationSchema.safeParse({
      type: "sms_code",
      targetNumber: "+15551234567",
      code: "12345",
    });

    assert.equal(result.success, false);
  });
});

describe("ChallengeSchema", () => {
  const challenge = {
    challengeId: "challenge_1234567890",
    question: "How many times was blue spoken?",
    options: [
      { id: "option_1234567890", label: "Three" },
      { id: "option_0987654321", label: "Four" },
    ],
    allowsMultiple: false,
    minSelections: 1,
    maxSelections: 1,
    expiresAt: "2026-08-05T00:00:00.000Z",
  };

  it("accepts an internally consistent challenge", () => {
    assert.equal(ChallengeSchema.safeParse(challenge).success, true);
  });

  it("rejects selection limits beyond available options", () => {
    assert.equal(
      ChallengeSchema.safeParse({ ...challenge, maxSelections: 3 }).success,
      false,
    );
  });
});

describe("InteractionTokenClaimsSchema", () => {
  it("binds a token to one interaction action and audience", () => {
    assert.equal(
      InteractionTokenClaimsSchema.safeParse({
        projectId: "project_123456789",
        interactionId: "interaction_123456789",
        action: "submit_challenge",
        audience: "https://client.example",
        nonce: "nonce_1234567890",
        issuedAt: 1_786_000_000,
        expiresAt: 1_786_000_300,
      }).success,
      true,
    );
  });
});

describe("Phase 2 contracts", () => {
  it("requires strong customer passwords", () => {
    assert.equal(
      CustomerRegistrationSchema.safeParse({
        email: "customer@example.com",
        password: "weak-password",
      }).success,
      false,
    );
  });

  it("requires HTTPS callback URLs", () => {
    assert.equal(
      UpdateProjectSchema.safeParse({
        callbackUrl: "http://customer.example/callback",
      }).success,
      false,
    );
  });
});
