import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PaidTokenPassAssertion,
  PaidTokenPassAssertionSchema,
  type PassportAssertion,
  PassportAssertionSchema,
  type RiskEvent,
  RiskEventSchema,
} from "./botblocker-proofs.js";

function validPassportAssertion(): PassportAssertion {
  const now = Date.now();
  return {
    assertionId: "assertion_0123456789",
    siteId: "site_0123456789abcdef",
    pairwiseSubjectId: "pairwise_0123456789abcdef",
    audience: "https://customer.example",
    nonce: "nonce_0123456789abcdef",
    issuedAt: now,
    expiresAt: now + 60_000,
  };
}

describe("PassportAssertionSchema", () => {
  it("accepts a valid pairwise assertion", () => {
    assert.equal(PassportAssertionSchema.safeParse(validPassportAssertion()).success, true);
  });

  it("rejects a browser-supplied 'verified' claim (and cannot be assigned at compile time)", () => {
    const valid = validPassportAssertion();

    // @ts-expect-error -- a Passport assertion must never carry a self-declared verified claim.
    const withVerified: PassportAssertion = { ...valid, verified: true };

    assert.equal(PassportAssertionSchema.safeParse(withVerified).success, false);
  });

  it("rejects an assertion carrying a cross-site global identifier field (and cannot be assigned at compile time)", () => {
    const valid = validPassportAssertion();

    // @ts-expect-error -- a Passport assertion must never carry a cross-site/global identifier.
    const withGlobalId: PassportAssertion = { ...valid, globalUserId: "user_0123456789" };

    assert.equal(PassportAssertionSchema.safeParse(withGlobalId).success, false);
  });
});

function validPaidTokenPassAssertion(): PaidTokenPassAssertion {
  const now = Date.now();
  return {
    assertionId: "assertion_9876543210",
    siteId: "site_0123456789abcdef",
    passId: "pass_0123456789abcdef",
    scope: "one_time",
    audience: "https://customer.example",
    nonce: "nonce_9876543210abcdef",
    issuedAt: now,
    expiresAt: now + 60_000,
  };
}

describe("PaidTokenPassAssertionSchema", () => {
  it("accepts a valid one_time-scope assertion", () => {
    assert.equal(
      PaidTokenPassAssertionSchema.safeParse(validPaidTokenPassAssertion()).success,
      true,
    );
  });

  it("accepts a valid all_sites-scope assertion", () => {
    assert.equal(
      PaidTokenPassAssertionSchema.safeParse({
        ...validPaidTokenPassAssertion(),
        scope: "all_sites",
      }).success,
      true,
    );
  });

  it("rejects an unrecognized scope", () => {
    const assertion = { ...validPaidTokenPassAssertion(), scope: "unlimited" };
    assert.equal(PaidTokenPassAssertionSchema.safeParse(assertion).success, false);
  });

  it("rejects a browser-supplied 'remainingQuota' claim (and cannot be assigned at compile time)", () => {
    const valid = validPaidTokenPassAssertion();

    // @ts-expect-error -- quota accounting is server-side ledger state, never asserted by the caller.
    const withQuota: PaidTokenPassAssertion = { ...valid, remainingQuota: 100 };

    assert.equal(PaidTokenPassAssertionSchema.safeParse(withQuota).success, false);
  });
});

function validRiskEvent(): RiskEvent {
  return { kind: "automation_indicator", occurredAt: Date.now() };
}

describe("RiskEventSchema", () => {
  it("accepts a non-honeypot risk event without a honeypot field", () => {
    assert.equal(RiskEventSchema.safeParse(validRiskEvent()).success, true);
  });

  it("accepts a honeypot_activation event carrying a honeypot field", () => {
    assert.equal(
      RiskEventSchema.safeParse({
        kind: "honeypot_activation",
        occurredAt: Date.now(),
        honeypot: { honeypotId: "honeypot_0000000001" },
      }).success,
      true,
    );
  });

  it("rejects a honeypot_activation event missing its honeypot field", () => {
    assert.equal(
      RiskEventSchema.safeParse({ kind: "honeypot_activation", occurredAt: Date.now() }).success,
      false,
    );
  });

  it("rejects an unrecognized kind", () => {
    assert.equal(
      RiskEventSchema.safeParse({ kind: "made_up_kind", occurredAt: Date.now() }).success,
      false,
    );
  });

  describe("reject-by-construction: no browser-supplied score or decision", () => {
    it("rejects a fabricated score field (and cannot be assigned at compile time)", () => {
      const valid = validRiskEvent();

      // @ts-expect-error -- a risk event must never carry a client-computed score.
      const withScore: RiskEvent = { ...valid, score: 42 };

      assert.equal(RiskEventSchema.safeParse(withScore).success, false);
    });

    it("rejects a fabricated decision field (and cannot be assigned at compile time)", () => {
      const valid = validRiskEvent();

      // @ts-expect-error -- a risk event must never carry a self-declared authoritative decision.
      const withDecision: RiskEvent = { ...valid, decision: "allow" };

      assert.equal(RiskEventSchema.safeParse(withDecision).success, false);
    });
  });
});
