import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { BalanceService } from "./balance-service.js";
import { BillingChargeService, computeBillableMinutes } from "./billing-charge-service.js";
import type { FinancialTransactionDocument } from "./billing-persistence.js";
import type { RateChartService } from "./rate-chart-service.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";

function eventAt(state: string, secondsFromEpoch: number) {
  return { state: state as never, occurredAt: new Date(secondsFromEpoch * 1_000) };
}

function fakeInteraction(overrides: Partial<VerificationRequestDocument> = {}): VerificationRequestDocument {
  return {
    _id: "int_1",
    projectId: "prj_1",
    customerId: "usr_1",
    type: "sms_code",
    targetNumber: "+14034701805",
    state: "succeeded",
    sequence: 3,
    correlationId: "req_1",
    browserResponse: false,
    smsDid: "trunk-1",
    freeQuotaCovered: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(),
    ...overrides,
  };
}

/** Same fake-collection convention as `balance-service.test.ts` — no real
 * Mongo connection needed to exercise `chargeCompletedInteraction`'s own
 * branching. */
function createFakeDb() {
  const ledgerRows: FinancialTransactionDocument[] = [];
  const balancesCollection = {
    findOne: async () => null,
    updateOne: async () => {},
  };
  const ledgerCollection = {
    insertOne: async (document: FinancialTransactionDocument) => {
      ledgerRows.push(document);
    },
    find: () => ({ sort: () => ({ toArray: async () => [] }) }),
  };
  const eventsCollection = { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
  const db = {
    collection: (name: string) => {
      if (name === "customerBalances") return balancesCollection;
      if (name === "financialTransactions") return ledgerCollection;
      return eventsCollection;
    },
  } as unknown as Db;
  const client = {
    startSession: () => ({
      withTransaction: async (fn: () => Promise<void>) => {
        await fn();
      },
      endSession: async () => {},
    }),
  } as never;
  return { db, client, ledgerRows };
}

describe("BillingChargeService.chargeCompletedInteraction", () => {
  it("always charges $0 with note free_quota for a free-quota-covered interaction, never consulting the rate chart", async () => {
    const { db, client, ledgerRows } = createFakeDb();
    const balances = new BalanceService(client, db);
    const neverCalledRates = {
      smsRateFor: async () => {
        throw new Error("rate chart must not be consulted for free-quota-covered interactions");
      },
      callRateFor: async () => {
        throw new Error("rate chart must not be consulted for free-quota-covered interactions");
      },
    } as unknown as RateChartService;
    const service = new BillingChargeService(db, balances, neverCalledRates);

    await service.chargeCompletedInteraction(fakeInteraction({ freeQuotaCovered: true }));

    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0]?.amountUsd, 0);
    assert.equal(ledgerRows[0]?.note, "free_quota");
    assert.equal(ledgerRows[0]?.type, "otp4");
  });

  it("skips charging entirely when nothing was ever really dispatched, even if marked free-quota-covered", async () => {
    const { db, client, ledgerRows } = createFakeDb();
    const balances = new BalanceService(client, db);
    const rates = {} as RateChartService;
    const service = new BillingChargeService(db, balances, rates);

    await service.chargeCompletedInteraction(
      fakeInteraction({ freeQuotaCovered: true, smsDid: undefined, callTrunkId: undefined }),
    );

    assert.equal(ledgerRows.length, 0);
  });

  it("charges email_code at the flat global rate, never a per-country one", async () => {
    const { db, client, ledgerRows } = createFakeDb();
    const balances = new BalanceService(client, db);
    const rates = {
      emailRateFor: async () => ({
        tier1PerEmailUsd: 0.01,
        tier2PerEmailUsd: 0.008,
        tier3PerEmailUsd: 0.005,
      }),
      callRateFor: async () => {
        throw new Error("call rate chart must not be consulted for email_code");
      },
      smsRateFor: async () => {
        throw new Error("sms rate chart must not be consulted for email_code");
      },
    } as unknown as RateChartService;
    const service = new BillingChargeService(db, balances, rates);

    await service.chargeCompletedInteraction(
      fakeInteraction({
        type: "email_code",
        targetNumber: "user@example.com",
        smsDid: undefined,
        emailSent: true,
      }),
    );

    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0]?.type, "otp5");
    assert.equal(ledgerRows[0]?.country, undefined);
    assert.equal(ledgerRows[0]?.amountUsd, -0.01);
  });

  it("charges $0 for email_code when no admin rate has been entered yet", async () => {
    const { db, client, ledgerRows } = createFakeDb();
    const balances = new BalanceService(client, db);
    const rates = { emailRateFor: async () => null } as unknown as RateChartService;
    const service = new BillingChargeService(db, balances, rates);

    await service.chargeCompletedInteraction(
      fakeInteraction({ type: "email_code", targetNumber: "user@example.com", smsDid: undefined, emailSent: true }),
    );

    assert.equal(ledgerRows[0]?.amountUsd, 0);
  });
});

describe("computeBillableMinutes", () => {
  it("bills 0 minutes when the call was never answered", () => {
    const events = [eventAt("queued", 0), eventAt("dispatching", 1), eventAt("failed", 5)];
    assert.equal(computeBillableMinutes(events), 0);
  });

  it("bills a 1-minute minimum for a short answered call", () => {
    const events = [eventAt("answered", 0), eventAt("succeeded", 1)];
    assert.equal(computeBillableMinutes(events), 1);
  });

  it("rounds up partial minutes", () => {
    const events = [eventAt("answered", 0), eventAt("awaiting_response", 61)];
    assert.equal(computeBillableMinutes(events), 2);
  });

  it("bills exactly whole minutes with no rounding artifact", () => {
    const events = [eventAt("answered", 100), eventAt("succeeded", 220)];
    assert.equal(computeBillableMinutes(events), 2);
  });
});
