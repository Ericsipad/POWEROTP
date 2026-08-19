import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";

import type {
  AccountReferralAttributionDocument,
  ReferralCodeDocument,
} from "./accounting-persistence.js";
import { ReferralError, ReferralService } from "./referral-service.js";

function createService(accountInsertError?: Error) {
  const codes: ReferralCodeDocument[] = [];
  const accounts: AccountReferralAttributionDocument[] = [];
  const audits: unknown[] = [];
  const db = {
    collection: (name: string) => {
      if (name === "referralCodes") {
        return {
          findOne: async (filter: { _id?: string; ownerUserId?: string; active?: boolean }) =>
            codes.find((row) =>
              (filter._id === undefined || row._id === filter._id) &&
              (filter.ownerUserId === undefined || row.ownerUserId === filter.ownerUserId) &&
              (filter.active === undefined || row.active === filter.active),
            ) ?? null,
          insertOne: async (row: ReferralCodeDocument) => {
            if (codes.some((existing) => existing._id === row._id)) throw new Error("duplicate");
            codes.push(row);
          },
        };
      }
      if (name === "accountReferralAttributions") {
        return {
          findOne: async (filter: { _id: string }) =>
            accounts.find((row) => row._id === filter._id) ?? null,
          insertOne: async (row: AccountReferralAttributionDocument) => {
            if (accountInsertError) throw accountInsertError;
            if (accounts.some((existing) => existing._id === row._id)) {
              throw Object.assign(new Error("duplicate"), { code: 11000 });
            }
            accounts.push(row);
          },
        };
      }
      if (name === "auditEvents") return { insertOne: async (row: unknown) => audits.push(row) };
      return { findOne: async () => null };
    },
  } as unknown as Db;
  const client = {
    startSession: () => ({
      withTransaction: (work: () => Promise<unknown>) => work(),
      endSession: async () => {},
    }),
  } as unknown as MongoClient;
  return { service: new ReferralService(client, db), accounts };
}

describe("ReferralService", () => {
  it("creates one unique non-reserved code per user", async () => {
    const { service } = createService();
    assert.equal((await service.createCode("usr_referrer", "my-code"))._id, "my-code");
    await assert.rejects(
      () => service.createCode("usr_referrer", "another-code"),
      (error: unknown) =>
        error instanceof ReferralError && error.code === "referral_code_already_exists",
    );
  });

  it("attributes the first valid non-self account referral only once", async () => {
    const { service, accounts } = createService();
    await service.createCode("usr_referrer", "my-code");
    assert.equal(await service.attributeAccount("usr_new", "my-code"), true);
    assert.equal(await service.attributeAccount("usr_new", "my-code"), true);
    assert.equal(await service.attributeAccount("usr_referrer", "my-code"), false);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.referrerUserId, "usr_referrer");
  });

  it("does not silently consume attribution when persistence fails", async () => {
    const failure = new Error("database unavailable");
    const { service } = createService(failure);
    await service.createCode("usr_referrer", "my-code");
    await assert.rejects(
      () => service.attributeAccount("usr_new", "my-code"),
      /database unavailable/,
    );
  });
});
