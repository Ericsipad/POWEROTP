import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";
import Stripe from "stripe";

import { BalanceService } from "./balance-service.js";
import type {
  PaymentProcessorEventDocument,
  TopupRequestDocument,
} from "./billing-persistence.js";
import { StripeTopupService } from "./stripe-service.js";

const DUMMY_SECRET_KEY = "sk_test_dummy";
const DUMMY_WEBHOOK_SECRET = "whsec_dummy";
const config = {
  STRIPE_SECRET_KEY: DUMMY_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: DUMMY_WEBHOOK_SECRET,
  PUBLIC_APP_URL: "https://powerotp.com",
};

function matchesStatus(
  status: string,
  expected?: string | { $in: string[] },
): boolean {
  if (!expected) return true;
  return typeof expected === "string" ? status === expected : expected.$in.includes(status);
}

function createFakeStores(failFirstLedgerInsert = false) {
  let balance: { _id: string; balanceUsd: number; tier: string } | undefined;
  let shouldFailLedger = failFirstLedgerInsert;
  const ledgerRows: Array<Record<string, unknown>> = [];
  const events = new Map<string, PaymentProcessorEventDocument>();
  const requests = new Map<string, TopupRequestDocument>();

  const eventCollection = {
    insertOne: async (document: PaymentProcessorEventDocument) => {
      if (events.has(document._id)) {
        throw Object.assign(new Error("duplicate event"), { code: 11000 });
      }
      events.set(document._id, structuredClone(document));
    },
    findOne: async ({ _id }: { _id: string }) => events.get(_id) ?? null,
    updateOne: async (
      filter: { _id: string; status?: string | { $in: string[] } },
      update: {
        $set?: Partial<PaymentProcessorEventDocument>;
        $unset?: { failureReason?: string };
      },
    ) => {
      const current = events.get(filter._id);
      if (!current || !matchesStatus(current.status, filter.status)) return { matchedCount: 0 };
      Object.assign(current, update.$set);
      if (update.$unset?.failureReason !== undefined) delete current.failureReason;
      return { matchedCount: 1 };
    },
  };
  const requestCollection = {
    insertOne: async (document: TopupRequestDocument) => {
      requests.set(document._id, structuredClone(document));
    },
    findOne: async (filter: { _id: string; status?: string }) => {
      const request = requests.get(filter._id);
      return request && (!filter.status || request.status === filter.status) ? request : null;
    },
    updateOne: async (
      filter: { _id: string; status?: string | { $in: string[] } },
      update: {
        $set?: Partial<TopupRequestDocument>;
        $unset?: { failureReason?: string };
      },
    ) => {
      const current = requests.get(filter._id);
      if (!current || !matchesStatus(current.status, filter.status)) return { matchedCount: 0 };
      Object.assign(current, update.$set);
      if (update.$unset?.failureReason !== undefined) delete current.failureReason;
      return { matchedCount: 1 };
    },
  };
  const balancesCollection = {
    findOne: async () => balance ?? null,
    updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      balance = { _id: "usr_1", balanceUsd: 0, tier: "tier1", ...balance, ...update.$set } as never;
    },
  };
  const ledgerCollection = {
    insertOne: async (document: Record<string, unknown>) => {
      if (shouldFailLedger) {
        shouldFailLedger = false;
        throw new Error("ledger unavailable");
      }
      ledgerRows.push(document);
    },
    updateOne: async () => ({ matchedCount: 1 }),
  };
  const db = {
    collection: (name: string) => {
      if (name === "paymentProcessorEvents") return eventCollection;
      if (name === "topupRequests") return requestCollection;
      if (name === "customerBalances") return balancesCollection;
      if (name === "billingIdempotencyClaims") {
        return { insertOne: async () => {}, findOne: async () => null };
      }
      return ledgerCollection;
    },
  } as unknown as Db;
  const client = {
    startSession: () => ({
      withTransaction: async (work: () => Promise<void>) => {
        const eventSnapshot = structuredClone([...events]);
        const requestSnapshot = structuredClone([...requests]);
        const ledgerLength = ledgerRows.length;
        const balanceSnapshot = balance ? structuredClone(balance) : undefined;
        try {
          await work();
        } catch (error) {
          events.clear();
          for (const [key, value] of eventSnapshot) events.set(key, value);
          requests.clear();
          for (const [key, value] of requestSnapshot) requests.set(key, value);
          ledgerRows.splice(ledgerLength);
          balance = balanceSnapshot;
          throw error;
        }
      },
      endSession: async () => {},
    }),
  } as unknown as MongoClient;
  const seedRequest = (amountUsd = 25) => {
    const now = new Date();
    requests.set("tur_1", {
      _id: "tur_1",
      userId: "usr_1",
      amountUsd,
      paymentProcessor: "stripe",
      processorCheckoutSessionId: "cs_test_1",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  };
  return {
    db,
    client,
    events,
    requests,
    ledgerRows,
    seedRequest,
    getBalance: () => balance,
  };
}

function checkoutEvent(
  eventId: string,
  amountUsd = 25,
  paymentStatus: "paid" | "unpaid" = "paid",
) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    created: 1_776_000_000,
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        payment_intent: "pi_test_1",
        payment_status: paymentStatus,
        currency: "usd",
        amount_total: amountUsd * 100,
        metadata: { topupRequestId: "tur_1" },
      },
    },
  };
}

async function deliver(
  service: StripeTopupService,
  stripe: Stripe,
  event: ReturnType<typeof checkoutEvent>,
) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: DUMMY_WEBHOOK_SECRET,
  });
  await service.handleWebhookEvent(payload, signature);
}

describe("StripeTopupService.createTopupCheckoutSession", () => {
  it("persists the request sent to Stripe and binds its request ID as metadata", async () => {
    const stores = createFakeStores();
    let metadataRequestId: string | undefined;
    const stripe = {
      checkout: {
        sessions: {
          create: async (
            input: { metadata?: { topupRequestId?: string } },
            options: { idempotencyKey?: string },
          ) => {
            metadataRequestId = input.metadata?.topupRequestId;
            assert.equal(options.idempotencyKey, `topup:${metadataRequestId}`);
            return { id: "cs_created", url: "https://checkout.stripe.com/session" };
          },
        },
      },
    } as unknown as Stripe;
    const service = new StripeTopupService(
      stores.db,
      config,
      new BalanceService(stores.client, stores.db),
      stripe,
    );

    assert.equal(
      await service.createTopupCheckoutSession("usr_1", 25),
      "https://checkout.stripe.com/session",
    );
    assert.equal(stores.requests.get(metadataRequestId!)?.status, "pending");
    assert.equal(
      stores.requests.get(metadataRequestId!)?.processorCheckoutSessionId,
      "cs_created",
    );
  });
});

describe("StripeTopupService.handleWebhookEvent", () => {
  it("matches the request, credits once, and records the processor event", async () => {
    const stores = createFakeStores();
    stores.seedRequest();
    const stripe = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      stores.db,
      config,
      new BalanceService(stores.client, stores.db),
      stripe,
    );

    await deliver(service, stripe, checkoutEvent("evt_1"));
    await deliver(service, stripe, checkoutEvent("evt_1"));

    assert.equal(stores.getBalance()?.balanceUsd, 25);
    assert.equal(stores.ledgerRows.length, 1);
    assert.equal(stores.requests.get("tur_1")?.status, "completed");
    assert.equal(stores.events.get("stripe:evt_1")?.status, "processed");
  });

  it("keeps a failed event retryable until the balance credit commits", async () => {
    const stores = createFakeStores(true);
    stores.seedRequest();
    const stripe = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      stores.db,
      config,
      new BalanceService(stores.client, stores.db),
      stripe,
    );

    await assert.rejects(() => deliver(service, stripe, checkoutEvent("evt_retry")), /ledger unavailable/);
    assert.equal(stores.events.get("stripe:evt_retry")?.status, "failed");
    await deliver(service, stripe, checkoutEvent("evt_retry"));
    assert.equal(stores.getBalance()?.balanceUsd, 25);
    assert.equal(stores.events.get("stripe:evt_retry")?.status, "processed");
  });

  it("records but does not credit a paid webhook that does not match its request", async () => {
    const stores = createFakeStores();
    stores.seedRequest(50);
    const stripe = new Stripe(DUMMY_SECRET_KEY);
    const service = new StripeTopupService(
      stores.db,
      config,
      new BalanceService(stores.client, stores.db),
      stripe,
    );

    await deliver(service, stripe, checkoutEvent("evt_mismatch", 25));
    assert.equal(stores.getBalance(), undefined);
    assert.equal(stores.events.get("stripe:evt_mismatch")?.status, "ignored");
  });

  it("rejects invalid signatures and missing configuration", async () => {
    const stores = createFakeStores();
    const stripe = new Stripe(DUMMY_SECRET_KEY);
    const configured = new StripeTopupService(
      stores.db,
      config,
      new BalanceService(stores.client, stores.db),
      stripe,
    );
    await assert.rejects(
      () => configured.handleWebhookEvent("{}", "t=1,v1=bad"),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "invalid_stripe_signature",
    );
    const unconfigured = new StripeTopupService(
      stores.db,
      { PUBLIC_APP_URL: "https://powerotp.com" },
      new BalanceService(stores.client, stores.db),
    );
    await assert.rejects(
      () => unconfigured.handleWebhookEvent("{}", "t=1,v1=bad"),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "billing_not_configured",
    );
  });
});
