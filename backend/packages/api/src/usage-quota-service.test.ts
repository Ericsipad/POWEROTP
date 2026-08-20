import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { PLATFORM_ADMIN_USER_ID, type CustomerAccountDocument } from "./persistence.js";
import { UsageQuotaService, type UsageQuotaDocument } from "./usage-quota-service.js";

/**
 * A minimal fake standing in for `usageQuotas`/`customerAccounts` — same
 * fake-collection convention used throughout this package's other service
 * tests (e.g. `balance-service.test.ts`, `node-service.test.ts`); no real
 * Mongo connection needed to exercise this service's own control flow.
 */
function createFakeDb(
  accountCreatedAt: Date,
  options: { balanceUsd?: number; hasPaidTopup?: boolean } = {},
) {
  let quota: UsageQuotaDocument | undefined;
  const balanceUsd = options.balanceUsd ?? 25;
  const hasPaidTopup = options.hasPaidTopup ?? true;

  const quotasCollection = {
    findOne: async () => quota ?? null,
    updateOne: async (
      filter: { windowStartAt?: Date },
      update: { $set?: Partial<UsageQuotaDocument>; $setOnInsert?: UsageQuotaDocument },
    ) => {
      if (update.$setOnInsert && !quota) {
        quota = update.$setOnInsert;
        return { matchedCount: 0, upsertedCount: 1 };
      }
      if (update.$set && quota) {
        quota = { ...quota, ...update.$set };
      }
      return { matchedCount: 1, upsertedCount: 0 };
    },
    findOneAndUpdate: async (
      filter: { windowStartAt?: Date },
      update: { $inc: Record<string, number> },
    ) => {
      if (!quota || (filter.windowStartAt && filter.windowStartAt.getTime() !== quota.windowStartAt.getTime())) {
        return null;
      }
      for (const [key, delta] of Object.entries(update.$inc)) {
        const field = key.split(".")[1] as keyof UsageQuotaDocument["counts"];
        quota.counts[field] = (quota.counts[field] ?? 0) + delta;
      }
      return quota;
    },
  };
  const customerAccountsCollection = {
    findOne: async () => ({ createdAt: accountCreatedAt }) as Pick<CustomerAccountDocument, "createdAt">,
  };
  const balancesCollection = {
    findOne: async () => ({ _id: "usr_1", balanceUsd }),
  };
  const ledgerCollection = {
    findOne: async () => hasPaidTopup ? { _id: "txn_topup", type: "topup" } : null,
  };

  const db = {
    collection: (name: string) => {
      if (name === "usageQuotas") return quotasCollection;
      if (name === "customerAccounts") return customerAccountsCollection;
      if (name === "customerBalances") return balancesCollection;
      return ledgerCollection;
    },
  } as unknown as Db;

  return { db, getQuota: () => quota };
}

describe("UsageQuotaService.tryConsumeFreeQuota", () => {
  it("consumes free quota for a configured type up to its limit", async () => {
    const { db } = createFakeDb(new Date());
    const service = new UsageQuotaService(db);

    for (let i = 0; i < 10; i += 1) {
      assert.equal(await service.tryConsumeFreeQuota("usr_1", "call_reachability"), true);
    }
    assert.equal(await service.tryConsumeFreeQuota("usr_1", "call_reachability"), false);
  });

  it("has no free quota at all for voice_challenge", async () => {
    const { db } = createFakeDb(new Date());
    const service = new UsageQuotaService(db);
    assert.equal(await service.tryConsumeFreeQuota("usr_1", "voice_challenge"), false);
  });

  it("requires both a paid top-up and a positive current balance", async () => {
    const withoutTopup = new UsageQuotaService(
      createFakeDb(new Date(), { hasPaidTopup: false }).db,
    );
    const withoutBalance = new UsageQuotaService(
      createFakeDb(new Date(), { balanceUsd: 0 }).db,
    );

    assert.equal(await withoutTopup.tryConsumeFreeQuota("usr_1", "email_code"), false);
    assert.equal(await withoutBalance.tryConsumeFreeQuota("usr_1", "email_code"), false);
  });

  it("tracks each verification type's quota independently", async () => {
    const { db } = createFakeDb(new Date());
    const service = new UsageQuotaService(db);

    for (let i = 0; i < 5; i += 1) {
      assert.equal(await service.tryConsumeFreeQuota("usr_1", "sms_code"), true);
    }
    assert.equal(await service.tryConsumeFreeQuota("usr_1", "sms_code"), false);
    // voice_code's own quota is untouched by sms_code's being exhausted.
    assert.equal(await service.tryConsumeFreeQuota("usr_1", "voice_code"), true);
  });

  it("denies free quota once the account's 180-day eligibility window has passed", async () => {
    const over180DaysAgo = new Date(Date.now() - 181 * 24 * 60 * 60 * 1_000);
    const { db } = createFakeDb(over180DaysAgo);
    const service = new UsageQuotaService(db);

    assert.equal(await service.tryConsumeFreeQuota("usr_1", "call_reachability"), false);
  });

  it("still grants free quota one day before the 180-day eligibility window passes", async () => {
    const under180DaysAgo = new Date(Date.now() - 179 * 24 * 60 * 60 * 1_000);
    const { db } = createFakeDb(under180DaysAgo);
    const service = new UsageQuotaService(db);

    assert.equal(await service.tryConsumeFreeQuota("usr_1", "call_reachability"), true);
  });

  it("grants email_code its own 1,000-per-window free quota", async () => {
    const { db } = createFakeDb(new Date());
    const service = new UsageQuotaService(db);

    for (let i = 0; i < 1_000; i += 1) {
      assert.equal(await service.tryConsumeFreeQuota("usr_1", "email_code"), true);
    }
    assert.equal(await service.tryConsumeFreeQuota("usr_1", "email_code"), false);
  });

  it("always grants unlimited free quota to the platform-admin-owned demo project", async () => {
    const { db } = createFakeDb(new Date());
    const service = new UsageQuotaService(db);
    assert.equal(await service.tryConsumeFreeQuota(PLATFORM_ADMIN_USER_ID, "voice_challenge"), true);
  });
});
