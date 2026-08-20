import { topupAmountsUsd } from "@powerotp/contracts";
import type { ClientSession, Db } from "mongodb";
import Stripe from "stripe";

import type { BalanceService } from "./balance-service.js";
import { BillingError } from "./balance-service.js";
import type {
  PaymentProcessorEventDocument,
  TopupRequestDocument,
} from "./billing-persistence.js";
import type { ProductionConfig } from "./config.js";
import { createSortableId } from "./security.js";

type StripeConfig = Pick<ProductionConfig, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "PUBLIC_APP_URL">;

class TopupAlreadyCompletedError extends Error {}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

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
  readonly #stripe: Stripe | undefined;
  readonly #events;
  readonly #requests;

  constructor(
    db: Db,
    private readonly config: StripeConfig,
    private readonly balances: BalanceService,
    stripeClient?: Stripe,
  ) {
    this.#stripe = stripeClient ?? (config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : undefined);
    this.#events = db.collection<PaymentProcessorEventDocument>("paymentProcessorEvents");
    this.#requests = db.collection<TopupRequestDocument>("topupRequests");
  }

  async createTopupCheckoutSession(userId: string, amountUsd: number): Promise<string> {
    if (!this.#stripe) throw new BillingError("billing_not_configured", 409);
    if (!(topupAmountsUsd as readonly number[]).includes(amountUsd)) {
      throw new BillingError("invalid_topup_amount", 400);
    }
    const now = new Date();
    const requestId = createSortableId("tur");
    await this.#requests.insertOne({
      _id: requestId,
      userId,
      amountUsd,
      paymentProcessor: "stripe",
      status: "creating",
      createdAt: now,
      updatedAt: now,
    });
    try {
      const session = await this.#stripe.checkout.sessions.create(
        {
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
          metadata: { topupRequestId: requestId },
          success_url: new URL("/dashboard?topup=success", this.config.PUBLIC_APP_URL).toString(),
          cancel_url: new URL("/dashboard?topup=canceled", this.config.PUBLIC_APP_URL).toString(),
        },
        { idempotencyKey: `topup:${requestId}` },
      );
      if (!session.url) throw new BillingError("stripe_session_missing_url", 502);
      await this.#requests.updateOne(
        { _id: requestId, status: "creating" },
        {
          $set: {
            processorCheckoutSessionId: session.id,
            status: "pending",
            updatedAt: new Date(),
          },
        },
      );
      return session.url;
    } catch (error) {
      await this.#requests.updateOne(
        { _id: requestId, status: "creating" },
        {
          $set: {
            status: "failed",
            failureReason: error instanceof Error ? error.message : "stripe_checkout_failed",
            updatedAt: new Date(),
          },
        },
      );
      throw error;
    }
  }

  /**
   * Verifies the raw webhook body's signature, then credits the ledger
   * exactly once per paid Stripe transaction. Every verified event is
   * retained in the generic processor-event collection; a paid event must
   * match the top-up request sent to Stripe before it can change a balance.
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

    const eventId = `stripe:${event.id}`;
    const checkoutSession = event.data.object as Partial<Stripe.Checkout.Session>;
    const received: PaymentProcessorEventDocument = {
      _id: eventId,
      paymentProcessor: "stripe",
      eventId: event.id,
      eventType: event.type,
      status: "received",
      topupRequestId: checkoutSession.metadata?.topupRequestId || undefined,
      processorCheckoutSessionId: checkoutSession.id || undefined,
      processorTransactionId:
        typeof checkoutSession.payment_intent === "string"
          ? checkoutSession.payment_intent
          : undefined,
      processorPaymentStatus: checkoutSession.payment_status || undefined,
      amountUsd:
        typeof checkoutSession.amount_total === "number"
          ? checkoutSession.amount_total / 100
          : undefined,
      currency: checkoutSession.currency || undefined,
      processorCreatedAt:
        typeof event.created === "number" ? new Date(event.created * 1_000) : undefined,
      livemode: event.livemode,
      receivedAt: new Date(),
    };
    try {
      await this.#events.insertOne(received);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.#events.findOne({ _id: eventId });
      if (!existing) throw error;
      if (existing.status === "processed" || existing.status === "ignored") return;
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      await this.#markEvent(eventId, "ignored", "event_type_not_used");
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const requestId = session.metadata?.topupRequestId;
    const request = requestId ? await this.#requests.findOne({ _id: requestId }) : null;
    const processorTransactionId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.id;
    if (
      !request ||
      request.paymentProcessor !== "stripe" ||
      session.payment_status !== "paid" ||
      session.currency !== "usd" ||
      session.amount_total !== Math.round(request.amountUsd * 100) ||
      (
        request.processorCheckoutSessionId !== undefined &&
        request.processorCheckoutSessionId !== session.id
      )
    ) {
      await this.#markEvent(eventId, "ignored", "topup_request_mismatch");
      return;
    }
    if (request.status === "completed") {
      await this.#markEvent(
        eventId,
        request.processorTransactionId === processorTransactionId ? "processed" : "ignored",
        request.processorTransactionId === processorTransactionId
          ? undefined
          : "topup_already_completed",
      );
      return;
    }

    try {
      await this.balances.applyLedgerEntries(
        [{
          userId: request.userId,
          type: "topup",
          amountUsd: request.amountUsd,
          paymentProcessor: "stripe",
          paymentProcessorTransactionId: processorTransactionId,
          paymentProcessorEventId: event.id,
          paymentRequestId: request._id,
        }],
        undefined,
        async (_rows, mongoSession) => {
          await this.#completeTopup(
            request,
            eventId,
            session.id,
            processorTransactionId,
            mongoSession,
          );
        },
      );
    } catch (error) {
      const completed = await this.#requests.findOne({ _id: request._id, status: "completed" });
      if (
        error instanceof TopupAlreadyCompletedError ||
        (
          isDuplicateKey(error) &&
          completed?.processorTransactionId === processorTransactionId
        )
      ) {
        await this.#markEvent(eventId, "processed");
        return;
      }
      await this.#markEvent(
        eventId,
        "failed",
        error instanceof Error ? error.message : "topup_processing_failed",
      );
      throw error;
    }
  }

  async #completeTopup(
    request: TopupRequestDocument,
    eventId: string,
    checkoutSessionId: string,
    processorTransactionId: string,
    session: ClientSession,
  ): Promise<void> {
    const completedAt = new Date();
    const requestResult = await this.#requests.updateOne(
      { _id: request._id, status: { $in: ["creating", "pending", "failed"] } },
      {
        $set: {
          processorCheckoutSessionId: checkoutSessionId,
          processorTransactionId,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
        },
        $unset: { failureReason: "" },
      },
      { session },
    );
    if (requestResult.matchedCount !== 1) throw new TopupAlreadyCompletedError();
    const eventResult = await this.#events.updateOne(
      { _id: eventId, status: { $in: ["received", "failed"] } },
      {
        $set: {
          status: "processed",
          processorCheckoutSessionId: checkoutSessionId,
          processorTransactionId,
          amountUsd: request.amountUsd,
          currency: "usd",
          processedAt: completedAt,
        },
        $unset: { failureReason: "" },
      },
      { session },
    );
    if (eventResult.matchedCount !== 1) throw new TopupAlreadyCompletedError();
  }

  async #markEvent(
    eventId: string,
    status: PaymentProcessorEventDocument["status"],
    failureReason?: string,
  ): Promise<void> {
    await this.#events.updateOne(
      { _id: eventId },
      {
        $set: {
          status,
          processedAt: new Date(),
          ...(failureReason ? { failureReason } : {}),
        },
        ...(!failureReason ? { $unset: { failureReason: "" } } : {}),
      },
    );
  }
}
