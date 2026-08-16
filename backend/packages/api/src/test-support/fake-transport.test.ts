import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerificationState, VerificationType } from "@powerotp/contracts";

import { createFakeTransport, type FakeOutcome } from "./fake-transport.js";

async function run(type: VerificationType, outcome?: FakeOutcome) {
  const states: VerificationState[] = [];
  const transport = createFakeTransport(outcome);
  await transport.dispatch(
    { interactionId: "int_1", type, targetNumber: "+15551234567" },
    {
      async advance(state) {
        states.push(state);
        return true;
      },
    },
  );
  return states;
}

describe("fake transport (test-only)", () => {
  it("drives call_reachability straight to succeeded once answered", async () => {
    assert.deepEqual(await run("call_reachability", "answered"), [
      "dispatching",
      "calling",
      "ringing",
      "answered",
      "succeeded",
    ]);
  });

  it("stops at awaiting_response for voice_code, leaving the result to submission", async () => {
    assert.deepEqual(await run("voice_code", "answered"), [
      "dispatching",
      "calling",
      "ringing",
      "answered",
      "playing",
      "awaiting_response",
    ]);
  });

  it("skips calling/ringing/answered/playing for sms_code", async () => {
    assert.deepEqual(await run("sms_code", "answered"), [
      "dispatching",
      "awaiting_response",
    ]);
  });

  it("fails on no_answer without reaching awaiting_response", async () => {
    assert.deepEqual(await run("call_reachability", "no_answer"), [
      "dispatching",
      "calling",
      "ringing",
      "failed",
    ]);
  });
});
