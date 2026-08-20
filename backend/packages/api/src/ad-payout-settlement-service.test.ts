import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { AdPayoutSettlementService } from "./ad-payout-settlement-service.js";
import type { BalanceService, LedgerEntryInput } from "./balance-service.js";
import type { FinancialTransactionDocument } from "./billing-persistence.js";
import { PLATFORM_ADMIN_USER_ID } from "./persistence.js";

describe("AdPayoutSettlementService", () => {
  it("settles one daily pool, excludes the demo, and links the immutable settlement", async () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const payout = {
      _id: "adp_1234567890123456",
      adSystemId: "ads_one",
      serviceDate: "2026-08-18",
      grossPayoutMicros: 10_000_000,
      enteredBy: "usr_admin",
      enteredAt: now,
      updatedAt: now,
      status: "entered" as const,
    };
    const payoutUpdates: unknown[] = [];
    const settlements: Array<Record<string, unknown>> = [];
    const db = {
      collection: (name: string) => {
        if (name === "adDailyPayouts") {
          return {
            find: () => ({ sort: () => ({ toArray: async () => [payout] }) }),
            updateOne: async (_filter: unknown, update: unknown) => {
              payoutUpdates.push(update);
              return { matchedCount: 1 };
            },
          };
        }
        if (name === "referralCommissionSettings") return { findOne: async () => null };
        if (name === "adSystems") return { findOne: async () => ({ _id: "ads_one", active: true }) };
        if (name === "projectAuthSessions") {
          return {
            aggregate: () => ({
              toArray: async () => [
                { _id: "prj_customer", filledSlots: 3 },
                { _id: "prj_demo", filledSlots: 100 },
              ],
            }),
          };
        }
        if (name === "projects") {
          return {
            find: () => ({
              toArray: async () => [
                { _id: "prj_customer", customerId: "usr_owner" },
                { _id: "prj_demo", customerId: PLATFORM_ADMIN_USER_ID },
              ],
            }),
          };
        }
        if (name === "projectReferralAttributions") {
          return { find: () => ({ toArray: async () => [] }) };
        }
        if (name === "adDailySettlements") {
          return {
            insertMany: async (documents: Array<Record<string, unknown>>) => {
              settlements.push(...documents);
            },
          };
        }
        if (name === "auditEvents") return { insertOne: async () => {} };
        return {};
      },
    } as unknown as Db;
    const applied: LedgerEntryInput[][] = [];
    const balances = {
      applyLedgerEntries: async (
        inputs: LedgerEntryInput[],
        key: string,
        onApplied: (
          rows: readonly (FinancialTransactionDocument | undefined)[],
          session: never,
        ) => Promise<void>,
      ) => {
        applied.push(inputs);
        assert.equal(key, `ad-payout:${payout._id}`);
        const rows = inputs.map((input, index) => ({
          _id: `txn_123456789012345${index}`,
          userId: input.userId,
          projectId: input.projectId,
          type: input.type,
          openingBalanceUsd: 0,
          tierAtTransaction: "tier1" as const,
          amountUsd: input.amountUsd as number,
          closingBalanceUsd: input.amountUsd as number,
          createdAt: now,
        }));
        await onApplied(rows, {} as never);
        return rows;
      },
    } as unknown as BalanceService;

    assert.equal(await new AdPayoutSettlementService(db, balances).settleEntered(now), false);
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.length, 1);
    assert.equal(applied[0]?.[0]?.userId, "usr_owner");
    assert.equal(applied[0]?.[0]?.amountUsd, 10);
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.totalFilledSlots, 3);
    assert.equal(payoutUpdates.length, 1);
  });
});
