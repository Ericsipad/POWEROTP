import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  botBlockerError,
  botBlockerUnavailable,
} from "../../../lib/botblocker-responses";

describe("Phase 8 BotBlocker HTTP responses", () => {
  it("returns a strict typed unavailable response without an outcome", async () => {
    const response = botBlockerUnavailable("not_implemented", false);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, {
      status: "unavailable",
      reason: "not_implemented",
      retryable: false,
    });
    assert.equal("outcome" in body, false);
    assert.equal("score" in body, false);
  });

  it("returns strict authentication and replay errors", async () => {
    for (const [code, status] of [
      ["authentication_required", 401],
      ["replay_detected", 409],
      ["idempotency_key_conflict", 409],
    ] as const) {
      const response = botBlockerError(code, status);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { status: "error", code });
    }
  });

  it("maps rate limiting to a retryable unavailable response", async () => {
    const response = botBlockerUnavailable("rate_limited", true, 429);
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(body.retryable, true);
  });

});
