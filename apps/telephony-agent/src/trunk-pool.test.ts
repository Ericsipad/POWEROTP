import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isProviderLevelFailure, TrunkPool } from "./trunk-pool.js";

describe("isProviderLevelFailure", () => {
  it("treats circuit/account-level codes as trunk failures", () => {
    assert.equal(isProviderLevelFailure("provider_unavailable"), true);
    assert.equal(isProviderLevelFailure("call_rejected"), true);
  });

  it("treats destination-side outcomes as not the trunk's fault", () => {
    assert.equal(isProviderLevelFailure("busy"), false);
    assert.equal(isProviderLevelFailure("no_answer"), false);
    assert.equal(isProviderLevelFailure("invalid_number"), false);
    assert.equal(isProviderLevelFailure("answered"), false);
  });
});

describe("TrunkPool", () => {
  it("rotates in round-robin order across multiple healthy trunks", () => {
    const pool = new TrunkPool(["trunk-1", "trunk-2", "trunk-3"]);
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-1", "trunk-2", "trunk-3"]);

    pool.reportOutcome("trunk-1", "answered");
    // trunk-1 was just tried, so it now sorts to the back.
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2", "trunk-3", "trunk-1"]);
  });

  it("skips a trunk once it crosses the failure threshold", () => {
    const pool = new TrunkPool(["trunk-1", "trunk-2"]);

    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    assert.ok(pool.pickHealthyTrunks().includes("trunk-1"), "not down before the threshold");

    pool.reportOutcome("trunk-1", "provider_unavailable");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"]);
  });

  it("becomes eligible again after its cool-down expires", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const pool = new TrunkPool(["trunk-1", "trunk-2"]);

    pool.reportOutcome("trunk-1", "call_rejected");
    pool.reportOutcome("trunk-1", "call_rejected");
    pool.reportOutcome("trunk-1", "call_rejected");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"]);

    t.mock.timers.tick(5 * 60_000 + 1);
    assert.ok(pool.pickHealthyTrunks().includes("trunk-1"), "eligible again once cool-down expires");
  });

  it("a busy/no_answer/success outcome resets an in-progress streak", () => {
    const pool = new TrunkPool(["trunk-1"]);

    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "busy");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    // Only 2 consecutive provider-level failures since the reset — still under threshold.
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-1"]);
  });

  it("doubles the cool-down on repeated failure and resets to the base window after a success", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const pool = new TrunkPool(["trunk-1", "trunk-2"]);

    for (let i = 0; i < 3; i += 1) pool.reportOutcome("trunk-1", "provider_unavailable");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"]);

    t.mock.timers.tick(5 * 60_000 + 1);
    pool.reportOutcome("trunk-1", "provider_unavailable");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"], "still down: cool-down doubled to 10min");

    t.mock.timers.tick(5 * 60_000 + 1);
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"], "10min hasn't elapsed yet");

    t.mock.timers.tick(5 * 60_000 + 1);
    pool.reportOutcome("trunk-1", "answered");
    assert.ok(pool.pickHealthyTrunks().includes("trunk-1"));

    // A success resets the cool-down back to the 5min base.
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    t.mock.timers.tick(5 * 60_000 + 1);
    assert.ok(pool.pickHealthyTrunks().includes("trunk-1"), "back down to the 5min base window");
  });

  it("drops health state for trunk ids removed from configuration", () => {
    const pool = new TrunkPool(["trunk-1", "trunk-2"]);
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    pool.reportOutcome("trunk-1", "provider_unavailable");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"]);

    pool.updateTrunkIds(["trunk-1", "trunk-2"]);
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-2"], "health state survives an unchanged id list");

    pool.updateTrunkIds(["trunk-3"]);
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-3"]);
  });

  it("wins rotation with zero special-casing when only one trunk is configured", () => {
    const pool = new TrunkPool(["trunk-1"]);
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-1"]);
    pool.reportOutcome("trunk-1", "busy");
    assert.deepEqual(pool.pickHealthyTrunks(), ["trunk-1"]);
  });
});
