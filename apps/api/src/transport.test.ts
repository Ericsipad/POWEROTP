import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductionConfig } from "./config.js";
import { SmsProviderError, type SmsService } from "./sms.js";
import { createSmsCodeTransport } from "./transport.js";

const config = {} as ProductionConfig;

async function run(sms: SmsService | undefined, code = "12345") {
  const transitions: Array<{ state: string; reasonCode?: string; smsDid?: string }> = [];
  await createSmsCodeTransport(config, sms).dispatch(
    { interactionId: "int_1", type: "sms_code", targetNumber: "+15551234567", code },
    {
      async advance(state, reasonCode, meta) {
        transitions.push({ state, reasonCode, smsDid: meta?.smsDid });
        return true;
      },
    },
  );
  return transitions;
}

describe("sms_code transport", () => {
  it("advances to awaiting_response after the provider accepts the SMS", async () => {
    const sent: string[] = [];
    const transitions = await run({
      async sendVerificationCode(targetNumber, code) {
        sent.push(targetNumber, code);
        return { did: "+15559990000" };
      },
    });

    assert.deepEqual(sent, ["+15551234567", "12345"]);
    assert.deepEqual(transitions, [
      { state: "dispatching", reasonCode: "sending_to_provider", smsDid: undefined },
      { state: "awaiting_response", reasonCode: "code_sent", smsDid: "+15559990000" },
    ]);
  });

  it("fails closed when the provider rejects the request", async () => {
    const transitions = await run({
      async sendVerificationCode() {
        throw new SmsProviderError("provider_rejected");
      },
    });

    assert.deepEqual(transitions.at(-1), {
      state: "failed",
      reasonCode: "provider_rejected",
      smsDid: undefined,
    });
  });

  it("stays unavailable without configured provider credentials", async () => {
    assert.deepEqual(await run(undefined), [
      { state: "failed", reasonCode: "method_not_available", smsDid: undefined },
    ]);
  });

  it("never calls the provider without an encrypted code to deliver", async () => {
    let called = false;
    const transitions = await run(
      {
        async sendVerificationCode() {
          called = true;
          return { did: "+15559990000" };
        },
      },
      "",
    );

    assert.equal(called, false);
    assert.deepEqual(transitions.at(-1), {
      state: "failed",
      reasonCode: "code_unavailable",
      smsDid: undefined,
    });
  });

  it("does not resend when another worker already claimed dispatch", async () => {
    let called = false;
    const transport = createSmsCodeTransport(config, {
      async sendVerificationCode() {
        called = true;
        return { did: "+15559990000" };
      },
    });

    await transport.dispatch(
      {
        interactionId: "int_1",
        type: "sms_code",
        targetNumber: "+15551234567",
        code: "12345",
      },
      {
        async advance() {
          return false;
        },
      },
    );

    assert.equal(called, false);
  });
});
