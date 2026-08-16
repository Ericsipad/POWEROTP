import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roundCurrency } from "./money.js";

describe("roundCurrency", () => {
  it("preserves fractional-cent VoIP.ms-scale values", () => {
    assert.equal(roundCurrency(0.0009), 0.0009);
  });

  it("rounds away floating-point drift from repeated addition", () => {
    let total = 0;
    for (let i = 0; i < 10; i++) total = roundCurrency(total + 0.1);
    assert.equal(total, 1);
  });
});
