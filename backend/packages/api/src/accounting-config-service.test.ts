import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  AccountingConfigError,
  AccountingConfigService,
  completeServiceDates,
} from "./accounting-config-service.js";

describe("ad payout entry calendar", () => {
  it("returns the latest ten complete UTC calendar days", () => {
    const dates = completeServiceDates(new Date("2026-08-19T23:59:59.000Z"));
    assert.equal(dates.length, 10);
    assert.equal(dates[0], "2026-08-18");
    assert.equal(dates[9], "2026-08-09");
    assert.equal(dates.includes("2026-08-19"), false);
  });

  it("does not permit a settled calendar payout to be rewritten", async () => {
    const serviceDate = completeServiceDates()[0]!;
    const db = {
      collection: (name: string) => {
        if (name === "adSystems") {
          return { findOne: async () => ({ _id: "ads_one", active: true }) };
        }
        if (name === "adDailyPayouts") {
          return {
            findOne: async () => ({
              _id: "adp_1234567890123456",
              adSystemId: "ads_one",
              serviceDate,
              status: "settled",
            }),
          };
        }
        return {};
      },
    } as unknown as Db;
    const service = new AccountingConfigService(db);
    await assert.rejects(
      () => service.savePayout("usr_admin", {
        adSystemId: "ads_one",
        serviceDate,
        grossPayoutUsd: "10",
      }),
      (error: unknown) =>
        error instanceof AccountingConfigError && error.code === "payout_already_settled",
    );
  });
});
