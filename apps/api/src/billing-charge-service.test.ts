import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeBillableMinutes } from "./billing-charge-service.js";

function eventAt(state: string, secondsFromEpoch: number) {
  return { state: state as never, occurredAt: new Date(secondsFromEpoch * 1_000) };
}

describe("computeBillableMinutes", () => {
  it("bills 0 minutes when the call was never answered", () => {
    const events = [eventAt("queued", 0), eventAt("dispatching", 1), eventAt("failed", 5)];
    assert.equal(computeBillableMinutes(events), 0);
  });

  it("bills a 1-minute minimum for a short answered call", () => {
    const events = [eventAt("answered", 0), eventAt("succeeded", 1)];
    assert.equal(computeBillableMinutes(events), 1);
  });

  it("rounds up partial minutes", () => {
    const events = [eventAt("answered", 0), eventAt("awaiting_response", 61)];
    assert.equal(computeBillableMinutes(events), 2);
  });

  it("bills exactly whole minutes with no rounding artifact", () => {
    const events = [eventAt("answered", 100), eventAt("succeeded", 220)];
    assert.equal(computeBillableMinutes(events), 2);
  });
});
