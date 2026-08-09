import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";
import Stripe from "stripe";

import { BalanceService } from "./balance-service.js";
import { StripeTopupService } from "./stripe-service.js";

const DUMMY_SECRET_KEY = "sk_test_dummy";
const DUMMY_WEBHOOK_SECRET = "whsec_dummy";

/** No real Mongo connection or Stripe network call — `webhooks.constructEvent`
 * is a local HMAC signature check, and `applyLedgerEntry` runs against the
 * same fake collection/session convention as `balance-service.test.ts`. */
function createFakeStores() {
  const processedEventIds = new Set<string>();
  let balance: { _id: string; balanceUsd: number; tier: string } | undefined;
  const ledgerRows: unknown[] = [];

  const processedEventsCollection = {
    insertOne: async (document: { _id: string }) => {
      if (processedEventIds.has(document._id)) {
        throw new Error("duplicate key");
      }
      processedEventIds.add(document._id);
      return { insertedId: document._id };
    },
  };
  const balancesCollection = {
    findOne: async () => balance ?? null,
    updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      balance = { _id: "usr_1", balanceUsd: 0, tier: "tier1", ...balance, ...update.$set } as never;
    },
  };
  const ledgerCollection = {
    insertOne: async (document: unknown) => {
      ledgerRows.push(document);
      return { insertedId: "txn_1" };
    },
  };

  const db = {
    collection: (name: string) => {
      if (name === "processedStripeEvents") return processedEventsCollection;
      if (name === "customerBalances") return balancesCollection;
      return ledgerCollection;
    },
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

function buildCheckoutCompletedEvent(userId: string, amountUsd: number, eventId: string) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        payment_intent: "pi_test_1",
        metadata: { userId, amountUsd: String(amountUsd) },
      },
    },
  };
}

describe("StripeTopupService.handleWebhookEvent", () => {
  it("credits the ledger on a validly signed checkout.session.completed event", async () => {
    const { db, client, getBalance } = createFakeStores();
    const balances = new BalanceService(client, db);
    const stripeClient = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      db,
      { STRIPE_SECRET_KEY: DUMMY_SECRET_KEY, STRIPE_WEBHOOK_SECRET: DUMMY_WEBHOOK_SECRET, PUBLIC_APP_URL: "https://powerotp.com" },
      balances,
      stripeClient,
    );

    const payload = JSON.stringify(buildCheckoutCompletedEvent("usr_1", 25, "evt_1"));
    const header = stripeClient.webhooks.generateTestHeaderString({
      payload,
      secret: DUMMY_WEBHOOK_SECRET,
    });

    await service.handleWebhookEvent(payload, header);
    assert.equal(getBalance()?.balanceUsd, 25);
  });

  it("never double-credits the same Stripe event id", async () => {
    const { db, client, getBalance } = createFakeStores();
    const balances = new BalanceService(client, db);
    const stripeClient = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      db,
      { STRIPE_SECRET_KEY: DUMMY_SECRET_KEY, STRIPE_WEBHOOK_SECRET: DUMMY_WEBHOOK_SECRET, PUBLIC_APP_URL: "https://powerotp.com" },
      balances,
      stripeClient,
    );

    const payload = JSON.stringify(buildCheckoutCompletedEvent("usr_1", 50, "evt_dup"));
    const header = stripeClient.webhooks.generateTestHeaderString({
      payload,
      secret: DUMMY_WEBHOOK_SECRET,
    });

    await service.handleWebhookEvent(payload, header);
    await service.handleWebhookEvent(payload, header);
    assert.equal(getBalance()?.balanceUsd, 50);
  });

  it("rejects a badly signed payload", async () => {
    const { db, client } = createFakeStores();
    const balances = new BalanceService(client, db);
    const stripeClient = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      db,
      { STRIPE_SECRET_KEY: DUMMY_SECRET_KEY, STRIPE_WEBHOOK_SECRET: DUMMY_WEBHOOK_SECRET, PUBLIC_APP_URL: "https://powerotp.com" },
      balances,
      stripeClient,
    );

    await assert.rejects(
      () => service.handleWebhookEvent(JSON.stringify({ type: "checkout.session.completed" }), "t=1,v1=bad"),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "invalid_stripe_signature",
    );
  });

  it("fails closed with billing_not_configured when Stripe credentials are unset", async () => {
    const { db, client } = createFakeStores();
    const balances = new BalanceService(client, db);
    const service = new StripeTopupService(db, { PUBLIC_APP_URL: "https://powerotp.com" }, balances);

    await assert.rejects(
      () => service.handleWebhookEvent("{}", "t=1,v1=bad"),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "billing_not_configured",
    );
  });
});
