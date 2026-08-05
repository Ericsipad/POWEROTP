import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InteractionTokenError,
  issueInteractionToken,
  verifyInteractionToken,
} from "./interaction-tokens.js";

const secret = "interaction-token-secret-with-32-plus-characters";
const claims = {
  projectId: "prj_1234567890123456",
  interactionId: "int_1234567890123456",
  action: "submit_code" as const,
  audience: "https://client.example",
};

describe("interaction tokens", () => {
  it("issues a token that verifies for the exact bound context", () => {
    const { token, nonce } = issueInteractionToken(secret, claims);
    const verified = verifyInteractionToken(token, secret, claims);
    assert.equal(verified.interactionId, claims.interactionId);
    assert.equal(verified.nonce, nonce);
  });

  it("rejects a token bound to a different interaction", () => {
    const { token } = issueInteractionToken(secret, claims);
    assert.throws(
      () =>
        verifyInteractionToken(token, secret, {
          ...claims,
          interactionId: "int_9999999999999999",
        }),
      InteractionTokenError,
    );
  });

  it("rejects a token signed with the wrong secret", () => {
    const { token } = issueInteractionToken(secret, claims);
    assert.throws(
      () => verifyInteractionToken(token, "a-completely-different-secret-32", claims),
      InteractionTokenError,
    );
  });

  it("rejects an expired token", () => {
    const { token } = issueInteractionToken(secret, claims, -1_000);
    assert.throws(() => verifyInteractionToken(token, secret, claims), InteractionTokenError);
  });
});
