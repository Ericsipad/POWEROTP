import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gateStates,
  isGateObservationPaused,
  isGatePageOpen,
  isGateTransitionAllowed,
} from "./states.js";

describe("gate state transitions", () => {
  it("exposes exactly the six documented states", () => {
    assert.deepEqual(gateStates, [
      "checking",
      "optimistic_allow",
      "observing",
      "otp_required",
      "verified",
      "unavailable",
    ]);
  });

  it("allows escalation and authoritative recovery paths", () => {
    assert.equal(isGateTransitionAllowed("checking", "optimistic_allow"), true);
    assert.equal(isGateTransitionAllowed("optimistic_allow", "otp_required"), true);
    assert.equal(isGateTransitionAllowed("observing", "otp_required"), true);
    assert.equal(isGateTransitionAllowed("otp_required", "verified"), true);
    assert.equal(isGateTransitionAllowed("verified", "observing"), true);
    assert.equal(isGateTransitionAllowed("unavailable", "otp_required"), true);
  });

  it("does not allow fail-open or allow states to bypass active OTP", () => {
    assert.equal(isGateTransitionAllowed("otp_required", "optimistic_allow"), false);
    assert.equal(isGateTransitionAllowed("otp_required", "observing"), false);
    assert.equal(isGateTransitionAllowed("otp_required", "unavailable"), false);
    assert.equal(isGateTransitionAllowed("observing", "unavailable"), false);
  });

  it("models page and observation behavior explicitly", () => {
    for (const state of gateStates) {
      assert.equal(isGatePageOpen(state), state !== "otp_required");
      assert.equal(isGateObservationPaused(state), state === "otp_required");
    }
  });
});
