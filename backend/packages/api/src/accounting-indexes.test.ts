import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { ensureAccountingIndexes } from "./accounting-persistence.js";
import { ensureBillingIndexes } from "./billing-persistence.js";

interface CreatedIndex {
  collection: string;
  keys: Record<string, number>;
  options?: Record<string, unknown>;
}

function fakeIndexDb(existing: Record<string, Array<Record<string, unknown>>>) {
  const created: CreatedIndex[] = [];
  const dropped: string[] = [];
  const db = {
    collection: (name: string) => ({
      listIndexes: () => ({ toArray: async () => existing[name] ?? [] }),
      dropIndex: async (indexName: string) => {
        dropped.push(`${name}:${indexName}`);
      },
      createIndex: async (
        keys: Record<string, number>,
        options?: Record<string, unknown>,
      ) => {
        created.push({ collection: name, keys, options });
        return "index";
      },
    }),
  } as unknown as Db;
  return { created, db, dropped };
}

describe("accounting integrity indexes", () => {
  it("replaces non-unique threshold and active-code owner indexes", async () => {
    const { created, db, dropped } = fakeIndexDb({
      billingThresholdRules: [{ name: "eventType_1_thresholdCount_1" }],
      referralCodes: [{ name: "ownerUserId_1" }],
    });
    await ensureAccountingIndexes(db);

    assert.deepEqual(dropped.sort(), [
      "billingThresholdRules:eventType_1_thresholdCount_1",
      "referralCodes:ownerUserId_1",
    ]);
    assert.equal(
      created.some((index) =>
        index.collection === "billingThresholdRules" &&
        index.options?.unique === true
      ),
      true,
    );
    assert.equal(
      created.some((index) =>
        index.collection === "referralCodes" &&
        index.options?.unique === true &&
        index.options?.partialFilterExpression !== undefined
      ),
      true,
    );
  });

  it("removes the ledger batch-key uniqueness and namespaces processor IDs", async () => {
    const { created, db, dropped } = fakeIndexDb({
      financialTransactions: [{ name: "idempotencyKey_1", unique: true }],
    });
    await ensureBillingIndexes(db);

    assert.deepEqual(dropped, ["financialTransactions:idempotencyKey_1"]);
    assert.equal(
      created.some((index) => "idempotencyKey" in index.keys),
      false,
    );
    assert.equal(
      created.some((index) =>
        index.keys.paymentProcessor === 1 &&
        index.keys.paymentProcessorTransactionId === 1 &&
        index.options?.unique === true
      ),
      true,
    );
  });
});
