import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApiUrl } from "./api-client.js";

describe("buildApiUrl", () => {
  it("targets the configured API origin", () => {
    assert.equal(
      buildApiUrl("/v1/auth/session", "https://api.powerotp.com"),
      "https://api.powerotp.com/v1/auth/session",
    );
  });

  it("rejects non-rooted paths", () => {
    assert.throws(
      () => buildApiUrl("v1/auth/session", "https://api.powerotp.com"),
      /must begin/,
    );
  });
});
