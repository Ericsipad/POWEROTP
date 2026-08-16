import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signCallbackBody, verifyCallbackSignature } from "./callback-signing.js";

const secret = "callback-signing-secret-with-32-plus-characters";
const body = JSON.stringify({ event: { interactionId: "int_1" } });

describe("callback signing", () => {
  it("verifies a signature produced for the same body and secret", () => {
    const timestamp = Date.now();
    const header = signCallbackBody(body, secret, timestamp);
    assert.equal(verifyCallbackSignature(body, secret, header, timestamp), true);
  });

  it("rejects a tampered body", () => {
    const header = signCallbackBody(body, secret);
    assert.equal(
      verifyCallbackSignature(body.replace("int_1", "int_2"), secret, header),
      false,
    );
  });

  it("rejects a signature outside the replay window", () => {
    const timestamp = Date.now() - 10 * 60 * 1_000;
    const header = signCallbackBody(body, secret, timestamp);
    assert.equal(verifyCallbackSignature(body, secret, header), false);
  });
});
