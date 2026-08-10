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
      type: "otp2",
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

    const entry = await service.applyLedgerEntry({ userId: "usr_1", type: "otp1", amountUsd: -2 });
    assert.equal(entry?.closingBalanceUsd, -1.5);
  });

  it("never records a ledger entry for the platform-admin-owned demo project", async () => {
    const { db, client, ledgerRows } = createFakeStores();
    const service = new BalanceService(client, db);

    const entry = await service.applyLedgerEntry({
      userId: PLATFORM_ADMIN_USER_ID,
      type: "otp1",
      amountUsd: -5,
    });
    assert.equal(entry, undefined);
    assert.equal(ledgerRows.length, 0);
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
