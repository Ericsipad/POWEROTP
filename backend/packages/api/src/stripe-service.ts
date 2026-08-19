import { topupAmountsUsd } from "@powerotp/contracts";
import type { Db } from "mongodb";
import Stripe from "stripe";

import type { BalanceService } from "./balance-service.js";
import { BillingError } from "./balance-service.js";
import type { ProcessedStripeEventDocument } from "./billing-persistence.js";
import type { ProductionConfig } from "./config.js";

type StripeConfig = Pick<ProductionConfig, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "PUBLIC_APP_URL">;

/**
 * Stripe fixed-amount balance top-ups ($5/$25/$50/$100 only — no arbitrary
 * custom amount). See `docs/AS_BUILT.md`'s "Customer balance billing"
 * section. Fails closed with `billing_not_configured` until
 * `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set in App Platform, the
 * same deferred-credential convention as every other provider in this
 * project. The `stripeClient` constructor param exists so tests can inject
 * a real `Stripe` instance against a dummy key (webhook signature
 * verification is a local HMAC check, no network call) without needing a
 * live secret.
 */
export class StripeTopupService {
  readonly #processedEvents;
  readonly #stripe: Stripe | undefined;

  constructor(
    db: Db,
    private readonly config: StripeConfig,
    private readonly balances: BalanceService,
    stripeClient?: Stripe,
  ) {
    this.#processedEvents = db.collection<ProcessedStripeEventDocument>("processedStripeEvents");
    this.#stripe = stripeClient ?? (config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : undefined);
  }

  async createTopupCheckoutSession(userId: string, amountUsd: number): Promise<string> {
    if (!this.#stripe) throw new BillingError("billing_not_configured", 409);
    if (!(topupAmountsUsd as readonly number[]).includes(amountUsd)) {
      throw new BillingError("invalid_topup_amount", 400);
    }

    const session = await this.#stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountUsd * 100),
            product_data: { name: `POWEROTP balance top-up ($${amountUsd})` },
          },
          quantity: 1,
        },
      ],
      metadata: { userId, amountUsd: String(amountUsd) },
      success_url: new URL("/dashboard?topup=success", this.config.PUBLIC_APP_URL).toString(),
      cancel_url: new URL("/dashboard?topup=canceled", this.config.PUBLIC_APP_URL).toString(),
    });
    if (!session.url) throw new BillingError("stripe_session_missing_url", 502);
    return session.url;
  }

  /**
   * Verifies the raw webhook body's signature, then credits the ledger
   * exactly once per Stripe event id — Stripe retries on any non-2xx
   * response, so this must be idempotent (`processedStripeEvents`, a
   * unique-key insert doubling as a claim). Only `checkout.session.completed`
   * is handled; every other event type is a silent no-op.
   */
  async handleWebhookEvent(rawBody: string, signatureHeader: string | undefined): Promise<void> {
    if (!this.#stripe || !this.config.STRIPE_WEBHOOK_SECRET) {
      throw new BillingError("billing_not_configured", 409);
    }
    if (!signatureHeader) throw new BillingError("missing_stripe_signature", 400);

    let event: Stripe.Event;
    try {
      event = this.#stripe.webhooks.constructEvent(rawBody, signatureHeader, this.config.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new BillingError("invalid_stripe_signature", 400);
    }

    if (event.type !== "checkout.session.completed") return;

    try {
      await this.#processedEvents.insertOne({ _id: event.id, processedAt: new Date() });
    } catch {
      // Already processed by an earlier delivery of the same event.
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const amountUsd = Number(session.metadata?.amountUsd);
    if (!userId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;

    await this.balances.applyLedgerEntry({
      userId,
      type: "topup",
      amountUsd,
      paymentProcessor: "stripe",
      paymentProcessorTransactionId:
        typeof session.payment_intent === "string" ? session.payment_intent : session.id,
    });
  }
}
