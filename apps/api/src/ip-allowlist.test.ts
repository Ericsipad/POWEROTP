import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isIpAllowed } from "./ip-allowlist.js";

describe("isIpAllowed", () => {
  it("matches an IP present in a comma-separated allowlist", () => {
    assert.equal(isIpAllowed("203.0.113.5", "198.51.100.1, 203.0.113.5"), true);
  });

  it("rejects an IP not in the allowlist", () => {
    assert.equal(isIpAllowed("203.0.113.9", "198.51.100.1, 203.0.113.5"), false);
  });

  it("rejects when either side is missing", () => {
    assert.equal(isIpAllowed(undefined, "203.0.113.5"), false);
    assert.equal(isIpAllowed("203.0.113.5", undefined), false);
  });
});
