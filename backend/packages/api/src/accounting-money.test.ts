import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocatePayoutMicros,
  microsToUsdDecimal,
  usdDecimalToMicros,
} from "./accounting-money.js";

describe("accounting money", () => {
  it("round-trips validated six-decimal USD amounts", () => {
    assert.equal(usdDecimalToMicros("12.345678"), 12_345_678);
    assert.equal(microsToUsdDecimal(12_345_678), "12.345678");
    assert.equal(microsToUsdDecimal(5_000_000), "5");
  });

  it("allocates the entire payout by filled slots", () => {
    const rows = allocatePayoutMicros(10_000_000, [
      { projectId: "project_b", filledSlots: 1 },
      { projectId: "project_a", filledSlots: 2 },
    ]);
    assert.equal(rows.reduce((sum, row) => sum + row.allocatedMicros, 0), 10_000_000);
    assert.deepEqual(rows, [
      { projectId: "project_a", filledSlots: 2, allocatedMicros: 6_666_667 },
      { projectId: "project_b", filledSlots: 1, allocatedMicros: 3_333_333 },
    ]);
  });

  it("uses project ID as deterministic equal-remainder tie breaker", () => {
    assert.deepEqual(
      allocatePayoutMicros(1, [
        { projectId: "project_b", filledSlots: 1 },
        { projectId: "project_a", filledSlots: 1 },
      ]),
      [
        { projectId: "project_a", filledSlots: 1, allocatedMicros: 1 },
        { projectId: "project_b", filledSlots: 1, allocatedMicros: 0 },
      ],
    );
  });

  it("returns no allocation when no slots were filled", () => {
    assert.deepEqual(
      allocatePayoutMicros(1_000_000, [{ projectId: "project_a", filledSlots: 0 }]),
      [],
    );
  });

  it("uses integer slot totals even when their number sum would be unsafe", () => {
    assert.deepEqual(
      allocatePayoutMicros(1_000_000, [
        { projectId: "project_a", filledSlots: Number.MAX_SAFE_INTEGER },
        { projectId: "project_b", filledSlots: Number.MAX_SAFE_INTEGER },
      ]),
      [
        {
          projectId: "project_a",
          filledSlots: Number.MAX_SAFE_INTEGER,
          allocatedMicros: 500_000,
        },
        {
          projectId: "project_b",
          filledSlots: Number.MAX_SAFE_INTEGER,
          allocatedMicros: 500_000,
        },
      ],
    );
  });
});
