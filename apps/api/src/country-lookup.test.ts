import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countryForE164 } from "./country-lookup.js";

describe("countryForE164", () => {
  it("resolves a US number", () => {
    assert.equal(countryForE164("+14155552671"), "US");
  });

  it("distinguishes NANP's shared +1 calling code (e.g. a Canadian area code)", () => {
    // +1 403 is Calgary, Alberta — this project's own real canary
    // destination number (see docs/AS_BUILT.md) is actually Canadian, not
    // American, which is exactly the kind of shared-calling-code mistake a
    // hand-rolled prefix table would get wrong.
    assert.equal(countryForE164("+14034701805"), "CA");
  });

  it("resolves a Thailand number, distinct from other +66-region numbers", () => {
    assert.equal(countryForE164("+66812345678"), "TH");
  });

  it("resolves a UK number", () => {
    assert.equal(countryForE164("+442071838750"), "GB");
  });

  it("returns undefined for an unparseable number", () => {
    assert.equal(countryForE164("+0000000"), undefined);
  });
});
