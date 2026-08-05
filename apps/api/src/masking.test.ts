import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskE164 } from "./masking.js";

describe("maskE164", () => {
  it("keeps only the last two digits visible", () => {
    assert.equal(maskE164("+15551234567"), "+•••••••••67");
  });

  it("keeps the leading plus sign", () => {
    assert.equal(maskE164("+447911123456").startsWith("+"), true);
  });
});
