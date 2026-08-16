import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type BotBlockerChallenge,
  type BotBlockerChallengeCompletion,
  BotBlockerChallengeCompletionSchema,
  BotBlockerChallengeSchema,
  type BotBlockerChallengeState,
  botBlockerChallengeStates,
  isBotBlockerChallengeExpired,
  isValidBotBlockerChallengeTransition,
} from "./botblocker-challenge.js";

function validChallenge(): BotBlockerChallenge {
  return {
    challengeId: "challenge_0123456789",
    gateSessionId: "gate_session_0123456789",
    siteId: "site_0123456789abcdef",
    state: "presented",
    prompt: "Select the odd one out",
    options: [
      { id: "option_0000000000000001", label: "Cat" },
      { id: "option_0000000000000002", label: "Dog" },
      { id: "option_0000000000000003", label: "Car" },
    ],
    allowsMultiple: false,
    minSelections: 1,
    maxSelections: 1,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 30_000,
  };
}

describe("BotBlockerChallengeSchema", () => {
  it("accepts a valid single-answer challenge", () => {
    assert.equal(BotBlockerChallengeSchema.safeParse(validChallenge()).success, true);
  });

  it("accepts a valid multi-answer challenge", () => {
    const challenge = {
      ...validChallenge(),
      allowsMultiple: true,
      minSelections: 1,
      maxSelections: 2,
    };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, true);
  });

  it("rejects fewer than 2 options", () => {
    const challenge = { ...validChallenge(), options: [validChallenge().options[0]!] };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });

  it("rejects minSelections greater than maxSelections", () => {
    const challenge = { ...validChallenge(), minSelections: 2, maxSelections: 1 };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });

  it("rejects maxSelections greater than the number of options", () => {
    const challenge = { ...validChallenge(), maxSelections: 10 };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });

  it("rejects a single-answer challenge requiring more than one selection", () => {
    const challenge = { ...validChallenge(), allowsMultiple: false, maxSelections: 2 };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });

  it("rejects expiresAt at or before issuedAt", () => {
    const now = Date.now();
    const challenge = { ...validChallenge(), issuedAt: now, expiresAt: now };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });

  it("rejects an unrecognized state", () => {
    const challenge = { ...validChallenge(), state: "in_progress" };
    assert.equal(BotBlockerChallengeSchema.safeParse(challenge).success, false);
  });
});

describe("BotBlockerChallengeCompletionSchema", () => {
  it("accepts a valid completion submission", () => {
    assert.equal(
      BotBlockerChallengeCompletionSchema.safeParse({
        challengeId: "challenge_0123456789",
        selectedOptionIds: ["option_0000000000000001"],
      }).success,
      true,
    );
  });

  it("rejects a browser-supplied 'passed' outcome (and cannot be assigned at compile time)", () => {
    const valid = {
      challengeId: "challenge_0123456789",
      selectedOptionIds: ["option_0000000000000001"],
    };

    // @ts-expect-error -- a completion submission must never carry an authoritative pass/fail outcome.
    const withPassed: BotBlockerChallengeCompletion = { ...valid, passed: true };

    assert.equal(BotBlockerChallengeCompletionSchema.safeParse(withPassed).success, false);
  });
});

describe("isValidBotBlockerChallengeTransition", () => {
  const cases: Array<[BotBlockerChallengeState, BotBlockerChallengeState, boolean]> = [
    ["pending", "presented", true],
    ["pending", "expired", true],
    ["pending", "canceled", true],
    ["pending", "completed", false],
    ["presented", "completed", true],
    ["presented", "expired", true],
    ["presented", "canceled", true],
    ["presented", "pending", false],
    ["completed", "presented", false],
    ["expired", "presented", false],
    ["canceled", "presented", false],
  ];

  for (const [from, to, expected] of cases) {
    it(`${from} -> ${to} is ${expected ? "valid" : "invalid"}`, () => {
      assert.equal(isValidBotBlockerChallengeTransition(from, to), expected);
    });
  }

  it("covers every declared challenge state as a 'from' state", () => {
    for (const state of botBlockerChallengeStates) {
      // Every state must produce a defined (possibly empty) transition list,
      // never throw, for every other declared state.
      for (const to of botBlockerChallengeStates) {
        assert.doesNotThrow(() => isValidBotBlockerChallengeTransition(state, to));
      }
    }
  });
});

describe("isBotBlockerChallengeExpired", () => {
  it("treats a challenge as expired exactly at its expiresAt instant", () => {
    assert.equal(isBotBlockerChallengeExpired({ expiresAt: 1_000 }, 1_000), true);
  });

  it("treats a challenge as expired after its expiresAt instant", () => {
    assert.equal(isBotBlockerChallengeExpired({ expiresAt: 1_000 }, 1_001), true);
  });

  it("treats a challenge as not expired before its expiresAt instant", () => {
    assert.equal(isBotBlockerChallengeExpired({ expiresAt: 1_000 }, 999), false);
  });
});
