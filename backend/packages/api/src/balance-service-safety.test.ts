import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";

import { BalanceService, type LedgerEntryInput } from "./balance-service.js";
import type {
  CustomerBalanceDocument,
  FinancialTransactionDocument,
} from "./billing-persistence.js";
import { PLATFORM_ADMIN_USER_ID } from "./persistence.js";

function createTransactionalService(
  retryFirstAttempt = false,
  raceUserId?: string,
) {
  const balances = new Map<string, CustomerBalanceDocument>();
  const externallyCommittedBalances = new Map<string, CustomerBalanceDocument>();
  const ledger: FinancialTransactionDocument[] = [];
  const claims = new Set<string>();
  const restore = (
    balanceSnapshot: Map<string, CustomerBalanceDocument>,
    ledgerLength: number,
    claimSnapshot: Set<string>,
  ) => {
    balances.clear();
    for (const [key, value] of balanceSnapshot) balances.set(key, value);
    ledger.splice(ledgerLength);
    claims.clear();
    for (const key of claimSnapshot) claims.add(key);
    for (const [key, value] of externallyCommittedBalances) balances.set(key, value);
  };
  const db = {
    collection: (name: string) => {
      if (name === "customerBalances") {
        return {
          findOne: async ({ _id }: { _id: string }) => balances.get(_id) ?? null,
          updateOne: async (
            { _id }: { _id: string },
            update: { $set: Omit<CustomerBalanceDocument, "_id"> },
          ) => {
            if (_id === raceUserId && !balances.has(_id)) {
              const external = {
                _id,
                balanceUsd: 5,
                tier: "tier1" as const,
                updatedAt: new Date(),
              };
              externallyCommittedBalances.set(_id, external);
              balances.set(_id, external);
              throw Object.assign(new Error("duplicate balance"), {
                code: 11000,
                keyValue: { _id },
              });
            }
            balances.set(_id, { _id, ...update.$set });
          },
        };
      }
      if (name === "billingIdempotencyClaims") {
        return {
          insertOne: async ({ _id }: { _id: string }) => {
            if (claims.has(_id)) throw Object.assign(new Error("duplicate claim"), { code: 11000 });
            claims.add(_id);
          },
          findOne: async ({ _id }: { _id: string }) => claims.has(_id) ? { _id } : null,
        };
      }
      return {
        insertOne: async (row: FinancialTransactionDocument) => ledger.push(row),
        find: () => ({
          sort: () => ({ limit: () => ({ toArray: async () => ledger }) }),
        }),
      };
    },
  } as unknown as Db;
  const client = {
    startSession: () => ({
      withTransaction: async (work: () => Promise<void>) => {
        const balanceSnapshot = new Map(balances);
        const ledgerLength = ledger.length;
        const claimSnapshot = new Set(claims);
        try {
          await work();
          if (retryFirstAttempt) {
            restore(balanceSnapshot, ledgerLength, claimSnapshot);
            await work();
          }
        } catch (error) {
          restore(balanceSnapshot, ledgerLength, claimSnapshot);
          throw error;
        }
      },
      endSession: async () => {},
    }),
  } as unknown as MongoClient;
  return { service: new BalanceService(client, db), balances, claims, ledger };
}

const sourceAndCommission = (): LedgerEntryInput[] => [
  { userId: "usr_owner", type: "daily_charge", amountUsd: -2 },
  {
    userId: "usr_referrer",
    type: "referral_commission",
    amountUsd: (_tier, rows) => Math.abs(rows[0]?.amountUsd ?? 0) * 0.1,
    sourceEntryIndex: 0,
    omitWhenZero: true,
  },
];

describe("BalanceService transaction safety", () => {
  it("returns and links only the successful withTransaction callback attempt", async () => {
    const { service, ledger } = createTransactionalService(true);
    const callbackAttempts: Array<readonly (FinancialTransactionDocument | undefined)[]> = [];
    const rows = await service.applyLedgerEntries(
      sourceAndCommission(),
      "daily-charge:project:2026-08-19",
      async (attemptRows) => {
        callbackAttempts.push([...attemptRows]);
      },
    );

    assert.equal(callbackAttempts.length, 2);
    assert.equal(rows.length, 2);
    assert.equal(ledger.length, 2);
    assert.equal(rows[1]?.sourceTransactionId, rows[0]?._id);
    assert.equal(rows[0]?._id, callbackAttempts[1]?.[0]?._id);
    assert.notEqual(callbackAttempts[0]?.[0]?._id, callbackAttempts[1]?.[0]?._id);
  });

  it("suppresses only a duplicate durable idempotency claim", async () => {
    const { service, claims } = createTransactionalService();
    claims.add("existing-claim");
    assert.deepEqual(
      await service.applyLedgerEntries(sourceAndCommission(), "existing-claim"),
      [],
    );

    await assert.rejects(
      () => service.applyLedgerEntries(
        sourceAndCommission(),
        "new-claim",
        async () => {
          throw Object.assign(new Error("unrelated duplicate"), { code: 11000 });
        },
      ),
      /unrelated duplicate/,
    );
  });

  it("keeps source indexes aligned when platform-admin rows are excluded", async () => {
    const { service } = createTransactionalService();
    const rows = await service.applyLedgerEntries([
      { userId: PLATFORM_ADMIN_USER_ID, type: "ad_revenue", amountUsd: 1 },
      {
        userId: "usr_unused_referrer",
        type: "referral_commission",
        amountUsd: (_tier, prior) => prior[0]?.amountUsd ?? 0,
        sourceEntryIndex: 0,
        omitWhenZero: true,
      },
      { userId: "usr_owner", type: "daily_charge", amountUsd: -2 },
      {
        userId: "usr_referrer",
        type: "referral_commission",
        amountUsd: (_tier, prior) => Math.abs(prior[2]?.amountUsd ?? 0) * 0.1,
        sourceEntryIndex: 2,
        omitWhenZero: true,
      },
    ]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.userId, "usr_owner");
    assert.equal(rows[1]?.sourceTransactionId, rows[0]?._id);
  });

  it("rejects unpaired payment processor references before writing", async () => {
    const { service, ledger } = createTransactionalService();
    await assert.rejects(
      () => service.applyLedgerEntry({
        userId: "usr_owner",
        type: "topup",
        amountUsd: 5,
        paymentProcessor: "stripe",
      }),
      /invalid_payment_processor_reference/,
    );
    assert.equal(ledger.length, 0);
  });

  it("retries a concurrent first balance insert without losing either amount", async () => {
    const { service, balances, ledger } = createTransactionalService(false, "usr_owner");
    const row = await service.applyLedgerEntry({
      userId: "usr_owner",
      type: "topup",
      amountUsd: 2,
    });

    assert.equal(row?.openingBalanceUsd, 5);
    assert.equal(row?.closingBalanceUsd, 7);
    assert.equal(balances.get("usr_owner")?.balanceUsd, 7);
    assert.equal(ledger.length, 1);
  });
});
