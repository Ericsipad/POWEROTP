import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isThresholdEligible, serviceDayBounds } from "./accounting-daily-service.js";

describe("daily accounting boundaries", () => {
  it("uses exact UTC calendar-day bounds", () => {
    const bounds = serviceDayBounds("2026-08-18");
    assert.equal(bounds.start.toISOString(), "2026-08-18T00:00:00.000Z");
    assert.equal(bounds.end.toISOString(), "2026-08-19T00:00:00.000Z");
  });

  it("requires both the configured count and the full 31-day cooldown", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    assert.equal(isThresholdEligible(999, 1_000, undefined, now), false);
    assert.equal(isThresholdEligible(1_000, 1_000, undefined, now), true);
    assert.equal(
      isThresholdEligible(
        1_000,
        1_000,
        new Date(now.getTime() - 31 * 86_400_000 + 1),
        now,
      ),
      false,
    );
    assert.equal(
      isThresholdEligible(
        1_000,
        1_000,
        new Date(now.getTime() - 31 * 86_400_000),
        now,
      ),
      true,
    );
  });
});
