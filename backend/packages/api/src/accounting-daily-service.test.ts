import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { isThresholdEligible, serviceDayBounds } from "./accounting-daily-service.js";
import { AccountingDailyService } from "./accounting-daily-service.js";
import type { BalanceService } from "./balance-service.js";
import type { FinancialTransactionDocument } from "./billing-persistence.js";
import type { RateChartService } from "./rate-chart-service.js";

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

  it("rechecks threshold cooldown state inside the ledger transaction", async () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    let thresholdStateReads = 0;
    const projects = [{
      _id: "prj_1",
      customerId: "usr_owner",
      active: true,
    }];
    const db = {
      collection: (name: string) => {
        if (name === "adDailyPayouts") {
          return { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
        }
        if (name === "projects") return { find: () => ({ toArray: async () => projects }) };
        if (name === "billingThresholdRules") {
          return {
            find: () => ({
              sort: () => ({
                toArray: async () => [{
                  _id: "rule_1",
                  eventType: "signup",
                  thresholdCount: 1,
                  tier1ChargeUsd: 2,
                  tier2ChargeUsd: 2,
                  tier3ChargeUsd: 2,
                  active: true,
                }],
              }),
            }),
          };
        }
        if (name === "referralCommissionSettings" || name === "projectReferralAttributions") {
          return { findOne: async () => null };
        }
        if (name === "projectAuthSessions") return { countDocuments: async () => 1 };
        if (name === "projectThresholdChargeStates") {
          return {
            findOne: async () => {
              thresholdStateReads += 1;
              return thresholdStateReads === 1 ? null : { lastChargedAt: now };
            },
            updateOne: async () => {
              throw new Error("ineligible threshold must not update state");
            },
          };
        }
        if (name === "auditEvents") return { insertOne: async () => {} };
        return {};
      },
    } as unknown as Db;
    const completedKeys: string[] = [];
    const sourceRow = {
      _id: "txn_1234567890123456",
      userId: "usr_owner",
      type: "signup_threshold_charge",
      openingBalanceUsd: 10,
      tierAtTransaction: "tier1",
      amountUsd: -2,
      closingBalanceUsd: 8,
      createdAt: now,
    } satisfies FinancialTransactionDocument;
    const balances = {
      applyLedgerEntries: async (
        _entries: unknown,
        key: string,
        onApplied?: (rows: readonly FinancialTransactionDocument[], session: never) => Promise<void>,
      ) => {
        if (onApplied) await onApplied([sourceRow], {} as never);
        completedKeys.push(key);
        return [sourceRow];
      },
    } as unknown as BalanceService;
    const rates = {
      planChargeFor: async () => null,
    } as unknown as RateChartService;

    await new AccountingDailyService(db, balances, rates).run(now);

    assert.equal(thresholdStateReads, 2);
    assert.equal(completedKeys.some((key) => key.startsWith("threshold:")), false);
    assert.equal(completedKeys.some((key) => key.startsWith("daily-charge:")), true);
  });
});
