import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTransitionAllowed,
  nextActiveState,
} from "./verification-state-machine.js";

describe("verification state machine", () => {
  it("allows sequential progress through the active states of a type", () => {
    assert.equal(
      isTransitionAllowed("call_reachability", "queued", "dispatching"),
      true,
    );
    assert.equal(
      isTransitionAllowed("call_reachability", "dispatching", "calling"),
      true,
    );
  });

  it("skips inapplicable states for methods without them", () => {
    assert.equal(nextActiveState("sms_code", "queued"), "dispatching");
    assert.equal(nextActiveState("sms_code", "dispatching"), "awaiting_response");
    assert.equal(
      isTransitionAllowed("sms_code", "dispatching", "calling"),
      false,
    );
  });

  it("rejects skipping ahead in the sequence", () => {
    assert.equal(
      isTransitionAllowed("voice_code", "queued", "ringing"),
      false,
    );
  });

  it("allows a terminal result to interrupt any active state", () => {
    assert.equal(isTransitionAllowed("voice_code", "ringing", "failed"), true);
    assert.equal(isTransitionAllowed("voice_code", "queued", "canceled"), true);
  });

  it("never allows a transition away from a terminal state", () => {
    assert.equal(
      isTransitionAllowed("voice_code", "succeeded", "failed"),
      false,
    );
  });

  it("allows succeeded once a response is awaited", () => {
    // The state machine permits a terminal result as an interrupt from any
    // active state; VerificationService.submitCode enforces the stricter
    // business rule that a code can only be graded from awaiting_response.
    assert.equal(
      isTransitionAllowed("voice_code", "awaiting_response", "succeeded"),
      true,
    );
  });
});
