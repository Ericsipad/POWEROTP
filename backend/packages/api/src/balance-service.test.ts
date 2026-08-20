import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";

import { BalanceService, BillingError, tierForBalance } from "./balance-service.js";
import type {
  CustomerBalanceDocument,
  FinancialTransactionDocument,
} from "./billing-persistence.js";
import { PLATFORM_ADMIN_USER_ID } from "./persistence.js";

describe("tierForBalance", () => {
  it("classifies tier1 below $50", () => {
    assert.equal(tierForBalance(0), "tier1");
    assert.equal(tierForBalance(49.99), "tier1");
  });

  it("classifies tier2 between $50 and $99.99", () => {
    assert.equal(tierForBalance(50), "tier2");
    assert.equal(tierForBalance(99.99), "tier2");
  });

  it("classifies tier3 at $100 and above", () => {
    assert.equal(tierForBalance(100), "tier3");
    assert.equal(tierForBalance(10_000), "tier3");
  });
});

/**
 * A minimal fake standing in for `customerBalances`/`financialTransactions`
 * plus a fake `MongoClient` session, matching the same fake-collection
 * convention already used in `modal-session-service.test.ts` /
 * `node-service.test.ts` — no real Mongo connection or transaction support
 * needed to exercise `applyLedgerEntry`'s own arithmetic/control flow.
 */
function createFakeStores(seedBalance?: CustomerBalanceDocument) {
  let balance = seedBalance;
  const ledgerRows: FinancialTransactionDocument[] = [];

  const balancesCollection = {
    findOne: async () => balance ?? null,
    updateOne: async (
      _filter: unknown,
      update: { $set: Partial<CustomerBalanceDocument> },
    ) => {
      balance = { _id: balance?._id ?? "usr_1", ...balance, ...update.$set } as CustomerBalanceDocument;
    },
  };
  const ledgerCollection = {
    insertOne: async (document: FinancialTransactionDocument) => {
      ledgerRows.push(document);
      return { insertedId: document._id };
    },
    find: () => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => [...ledgerRows].reverse(),
        }),
      }),
    }),
  };

  const db = {
    collection: (name: string) => (name === "customerBalances" ? balancesCollection : ledgerCollection),
  } as unknown as Db;

  const client = {
    startSession: () => ({
      withTransaction: async (fn: () => Promise<void>) => {
        await fn();
      },
      endSession: async () => {},
    }),
  } as unknown as MongoClient;

  return { db, client, ledgerRows, getBalance: () => balance };
}

describe("BalanceService.applyLedgerEntry", () => {
  it("credits a new customer starting from a zero balance", async () => {
    const { db, client, ledgerRows } = createFakeStores();
    const service = new BalanceService(client, db);

    const entry = await service.applyLedgerEntry({ userId: "usr_1", type: "topup", amountUsd: 25 });
    assert.equal(entry?.openingBalanceUsd, 0);
    assert.equal(entry?.closingBalanceUsd, 25);
    assert.equal(entry?.tierAtTransaction, "tier1");
    assert.equal(ledgerRows.length, 1);
  });

  it("resolves a tier-dependent charge amount using the opening tier", async () => {
    const { db, client } = createFakeStores({
      _id: "usr_1",
      balanceUsd: 150,
      tier: "tier3",
      updatedAt: new Date(),
    });
    const service = new BalanceService(client, db);

    const entry = await service.applyLedgerEntry({
      userId: "usr_1",
      type: "voice_code",
      amountUsd: (tier) => (tier === "tier3" ? -0.01 : -0.05),
    });
    assert.equal(entry?.tierAtTransaction, "tier3");
    assert.equal(entry?.amountUsd, -0.01);
    assert.equal(entry?.closingBalanceUsd, 149.99);
  });

  it("allows balance to go negative from a charge (no enforcement inside applyLedgerEntry itself)", async () => {
    const { db, client } = createFakeStores({
      _id: "usr_1",
      balanceUsd: 0.5,
      tier: "tier1",
      updatedAt: new Date(),
    });
    const service = new BalanceService(client, db);

    const entry = await service.applyLedgerEntry({ userId: "usr_1", type: "call_reachability", amountUsd: -2 });
    assert.equal(entry?.closingBalanceUsd, -1.5);
  });

  it("never records a ledger entry for the platform-admin-owned demo project", async () => {
    const { db, client, ledgerRows } = createFakeStores();
    const service = new BalanceService(client, db);

    const entry = await service.applyLedgerEntry({
      userId: PLATFORM_ADMIN_USER_ID,
      type: "call_reachability",
      amountUsd: -5,
    });
    assert.equal(entry, undefined);
    assert.equal(ledgerRows.length, 0);
  });
});

describe("BalanceService.applyLedgerEntries", () => {
  it("writes related owner and referral rows in order with source linkage", async () => {
    const balanceByUser = new Map<string, CustomerBalanceDocument>([
      ["usr_owner", { _id: "usr_owner", balanceUsd: 60, tier: "tier2", updatedAt: new Date() }],
      ["usr_referrer", { _id: "usr_referrer", balanceUsd: 0, tier: "tier1", updatedAt: new Date() }],
    ]);
    const ledgerRows: FinancialTransactionDocument[] = [];
    const db = {
      collection: (name: string) => {
        if (name === "customerBalances") {
          return {
            findOne: async (filter: { _id: string }) => balanceByUser.get(filter._id) ?? null,
            updateOne: async (
              filter: { _id: string },
              update: { $set: Omit<CustomerBalanceDocument, "_id"> },
            ) => balanceByUser.set(filter._id, { _id: filter._id, ...update.$set }),
          };
        }
        return {
          insertOne: async (document: FinancialTransactionDocument) => {
            ledgerRows.push(document);
          },
          updateOne: async (
            filter: { _id: string },
            update: { $set: Partial<FinancialTransactionDocument> },
          ) => {
            const row = ledgerRows.find((entry) => entry._id === filter._id);
            if (row) Object.assign(row, update.$set);
          },
        };
      },
    } as unknown as Db;
    const client = {
      startSession: () => ({
        withTransaction: async (work: () => Promise<void>) => work(),
        endSession: async () => {},
      }),
    } as unknown as MongoClient;
    const service = new BalanceService(client, db);

    const rows = await service.applyLedgerEntries([
      {
        userId: "usr_owner",
        projectId: "prj_1",
        type: "signup_threshold_charge",
        amountUsd: (tier) => (tier === "tier2" ? -2 : -3),
      },
      {
        userId: "usr_referrer",
        projectId: "prj_1",
        type: "signup_referral_credit",
        amountUsd: (_tier, prior) => Math.abs(prior[0]?.amountUsd ?? 0) * 0.1,
        sourceEntryIndex: 0,
        referralCode: "partner-one",
        commissionPercent: 10,
      },
    ]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.tierAtTransaction, "tier2");
    assert.equal(rows[1]?.amountUsd, 0.2);
    assert.equal(rows[1]?.sourceTransactionId, rows[0]?._id);
    assert.equal(rows[1]?.commissionBaseUsd, 2);
    assert.equal(rows[0]?.referralProcessed, true);
    assert.equal(rows[0]?.referralTransactionId, rows[1]?._id);
    assert.equal(balanceByUser.get("usr_owner")?.balanceUsd, 58);
    assert.equal(balanceByUser.get("usr_referrer")?.balanceUsd, 0.2);
  });
});

describe("BalanceService.requireNonNegativeBalance", () => {
  it("throws insufficient_balance once balance is at or below zero", async () => {
    const { db, client } = createFakeStores({
      _id: "usr_1",
      balanceUsd: 0,
      tier: "tier1",
      updatedAt: new Date(),
    });
    const service = new BalanceService(client, db);

    await assert.rejects(
      () => service.requireNonNegativeBalance("usr_1"),
      (error: unknown) => error instanceof BillingError && error.code === "insufficient_balance",
    );
  });

  it("passes for any positive balance, with no per-type minimum floor", async () => {
    const { db, client } = createFakeStores({
      _id: "usr_1",
      balanceUsd: 0.01,
      tier: "tier1",
      updatedAt: new Date(),
    });
    const service = new BalanceService(client, db);
    await service.requireNonNegativeBalance("usr_1");
  });

  it("always exempts the platform-admin-owned demo project", async () => {
    const { db, client } = createFakeStores();
    const service = new BalanceService(client, db);
    await service.requireNonNegativeBalance(PLATFORM_ADMIN_USER_ID);
  });
});
