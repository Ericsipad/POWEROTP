import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import { BotBlockerVisitorTokenService } from "./botblocker-visitor-token.js";

const secret = "visitor-token-secret".repeat(2);
const now = 1_786_000_000_000;
const scope = {
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
  gateSessionId: "bgs_1234567890123456",
  audience: "https://customer.example",
};

describe("BotBlockerVisitorTokenService", () => {
  it("issues a 30-minute token scoped to project, site, session, and audience", () => {
    const service = new BotBlockerVisitorTokenService({
      BOTBLOCKER_VISITOR_TOKEN_SECRET: secret,
    });
    const issued = service.issue(scope, now);
    const claims = service.verify(
      `Bearer ${issued.token}`,
      scope,
      now + 29 * 60_000,
    );
    assert.equal(claims.expiresAt, now + 30 * 60_000);
    assert.equal(issued.metadata.tokenId, claims.tokenId);
    assert.equal(issued.metadata.expiresAt.getTime(), claims.expiresAt);
    assert.match(issued.metadata.nonceDigest, /^[a-f0-9]{64}$/);
    assert.match(issued.metadata.tokenDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(issued.metadata).includes(issued.token), false);
    assert.equal(JSON.stringify(issued.metadata).includes(claims.nonce), false);
  });

  it("rejects tampering, expiry, and every scope mismatch", () => {
    const service = new BotBlockerVisitorTokenService({
      BOTBLOCKER_VISITOR_TOKEN_SECRET: secret,
    });
    const issued = service.issue(scope, now);
    const failures = [
      { ...scope, projectId: "prj_other_1234567890" },
      { ...scope, siteId: "bbs_other_1234567890" },
      { ...scope, gateSessionId: "bgs_other_1234567890" },
      { ...scope, audience: "https://other.example" },
    ];
    for (const expected of failures) {
      assert.throws(
        () => service.verify(`Bearer ${issued.token}`, expected, now + 1),
        BotBlockerRuntimeError,
      );
    }
    assert.throws(
      () => service.verify(`Bearer ${issued.token}x`, scope, now + 1),
      BotBlockerRuntimeError,
    );
    assert.throws(
      () => service.verify(`Bearer ${issued.token}`, scope, now + 30 * 60_000),
      BotBlockerRuntimeError,
    );
  });
});
