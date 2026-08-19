import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOTBLOCKER_PROTOCOL_VERSION } from "@powerotp/contracts/browser";
import { validateVerifiedDecision } from "./decision.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "site_phase9_123456";
const SESSION_ID = "gate_session_phase9";
const AUDIENCE = "https://customer.example";

function decision(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId: SITE_ID,
    sequence: { gateSessionId: SESSION_ID, sequence: 1, issuedAt: NOW },
    outcome: "allow",
    audience: AUDIENCE,
    nonce: "nonce_phase9_123456",
    expiresAt: NOW + 10_000,
    ...overrides,
  };
}

const context = {
  siteId: SITE_ID,
  gateSessionId: SESSION_ID,
  audience: AUDIENCE,
  now: NOW,
  acceptedNonces: new Set<string>(),
};

describe("verified decision validation", () => {
  it("requires the external authenticity verifier", () => {
    assert.deepEqual(
      validateVerifiedDecision({ verified: false, reason: "unsigned" }, context),
      { accepted: false, reason: "unverified" },
    );
  });

  it("accepts a strict, current, correctly bound allow or otp decision", () => {
    for (const outcome of ["allow", "otp"]) {
      const result = validateVerifiedDecision(
        { verified: true, decision: decision({ outcome }) },
        context,
      );
      assert.equal(result.accepted, true);
      if (result.accepted) assert.equal(result.decision.outcome, outcome);
    }
  });

  it("rejects malformed input and a third decision outcome", () => {
    for (const candidate of [{}, decision({ outcome: "deny" }), decision({ score: 100 })]) {
      assert.deepEqual(
        validateVerifiedDecision({ verified: true, decision: candidate }, context),
        { accepted: false, reason: "malformed" },
      );
    }
  });

  it("rejects expired and incorrectly bound decisions", () => {
    const cases = [
      [decision({ expiresAt: NOW }), "expired"],
      [decision({ siteId: "different_site_1234" }), "wrong_site"],
      [decision({ audience: "https://attacker.example" }), "wrong_audience"],
      [
        decision({
          sequence: { gateSessionId: "other_gate_session", sequence: 1, issuedAt: NOW },
        }),
        "wrong_session",
      ],
      [
        decision({
          sequence: {
            gateSessionId: SESSION_ID,
            sequence: 1,
            issuedAt: NOW + 300_001,
          },
        }),
        "future_issued",
      ],
    ] as const;

    for (const [candidate, reason] of cases) {
      assert.deepEqual(
        validateVerifiedDecision({ verified: true, decision: candidate }, context),
        { accepted: false, reason },
      );
    }
  });

  it("rejects stale sequences and nonce replay", () => {
    assert.deepEqual(
      validateVerifiedDecision(
        { verified: true, decision: decision() },
        {
          ...context,
          lastApplied: { gateSessionId: SESSION_ID, sequence: 1, issuedAt: NOW - 1 },
        },
      ),
      { accepted: false, reason: "stale" },
    );
    assert.deepEqual(
      validateVerifiedDecision(
        { verified: true, decision: decision() },
        { ...context, acceptedNonces: new Set(["nonce_phase9_123456"]) },
      ),
      { accepted: false, reason: "replay" },
    );
  });
});
