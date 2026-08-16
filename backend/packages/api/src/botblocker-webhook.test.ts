import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBotBlockerWebhookId,
  verifyBotBlockerWebhookId,
  withVerifiedBotBlockerWebhook,
} from "./botblocker-webhook.js";

const secret = "endpoint-secret".repeat(3);
const projectId = "prj_12345678-1234-1234-1234-123456789012";
const siteId = "bbs_12345678-1234-1234-1234-123456789012";

describe("BotBlocker webhook endpoint tokens", () => {
  it("binds the immutable endpoint to one exact project and site", () => {
    const token = createBotBlockerWebhookId(projectId, siteId, secret);
    const claims = verifyBotBlockerWebhookId(token, secret);
    assert.equal(claims?.version, 1);
    assert.equal(claims?.projectId, projectId);
    assert.equal(claims?.siteId, siteId);
    assert.equal(claims?.endpointId.length, 24);
  });

  it("rejects malformed and tampered values locally", () => {
    const token = createBotBlockerWebhookId(projectId, siteId, secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    assert.equal(verifyBotBlockerWebhookId("random", secret), undefined);
    assert.equal(verifyBotBlockerWebhookId(tampered, secret), undefined);
    assert.equal(verifyBotBlockerWebhookId(token, "wrong-secret".repeat(3)), undefined);
    assert.equal(verifyBotBlockerWebhookId(token, undefined), undefined);
  });

  it("does not enter shared-state/body/auth work for malformed or tampered paths", () => {
    const token = createBotBlockerWebhookId(projectId, siteId, secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    let downstreamCalls = 0;
    const downstream = () => {
      downstreamCalls += 1;
      return "would touch Valkey, MongoDB, body parsing, and authentication";
    };
    assert.equal(
      withVerifiedBotBlockerWebhook("malformed", secret, downstream),
      undefined,
    );
    assert.equal(
      withVerifiedBotBlockerWebhook(tampered, secret, downstream),
      undefined,
    );
    assert.equal(downstreamCalls, 0);
  });
});
