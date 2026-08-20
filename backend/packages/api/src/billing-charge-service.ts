import { otpChargeTypeFor } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { BalanceService, LedgerEntryInput } from "./balance-service.js";
import { countryForE164 } from "./country-lookup.js";
import { PLATFORM_ADMIN_USER_ID } from "./persistence.js";
import type { RateChartService } from "./rate-chart-service.js";
import type { VerificationEventDocument, VerificationRequestDocument } from "./verification-persistence.js";

/**
 * Billed minutes for one voice interaction, computed from **our own** event
 * timeline (never a guessed provider field) — the time between the
 * interaction's own `answered` event and its terminal event, rounded up to
 * a whole minute, with a 1-minute minimum once answered. A call that never
 * answered (busy/no-answer/rejected) bills 0 minutes, matching real
 * telephony billing norms. Exported as a pure function (no Mongo/service
 * dependency) so it is directly unit-testable against a fake event array.
 */
export function computeBillableMinutes(events: Pick<VerificationEventDocument, "state" | "occurredAt">[]): number {
  const answered = events.find((event) => event.state === "answered");
  if (!answered) return 0;
  const terminal = events[events.length - 1];
  if (!terminal) return 0;
  const seconds = Math.max(0, (terminal.occurredAt.getTime() - answered.occurredAt.getTime()) / 1000);
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Bridges `VerificationService`'s completed-interaction hook to the billing
 * ledger — see `docs/AS_BUILT.md`'s "Customer balance billing" section for
 * the full charge-trigger design. Charges exactly once per interaction,
 * called from `VerificationService#transition` at the same point provider
 * cost reconciliation is already scheduled from (the first crossing into
 * "delivery is done"), never waiting on VoIP.ms's own CDR reconciliation.
 */
export class BillingChargeService {
  readonly #events;
  readonly #requests;

  constructor(
    db: Db,
    private readonly balances: BalanceService,
    private readonly rates: RateChartService,
  ) {
    this.#events = db.collection<VerificationEventDocument>("verificationEvents");
    this.#requests = db.collection<VerificationRequestDocument>("verificationRequests");
  }

  async #applyCharge(
    verification: VerificationRequestDocument,
    input: LedgerEntryInput,
  ): Promise<void> {
    await this.balances.applyLedgerEntry(input, `otp:${verification._id}`);
    await this.#requests.updateOne(
      { _id: verification._id },
      { $set: { billingAppliedAt: new Date() } },
    );
  }

  async retryPendingCharges(): Promise<void> {
    const pending = await this.#requests.find({
      billingPendingAt: { $exists: true },
      billingAppliedAt: { $exists: false },
    }).toArray();
    for (const verification of pending) {
      await this.chargeCompletedInteraction(verification);
    }
  }

  async chargeCompletedInteraction(verification: VerificationRequestDocument): Promise<void> {
    if (verification.customerId === PLATFORM_ADMIN_USER_ID) {
      await this.#requests.updateOne(
        { _id: verification._id },
        { $set: { billingAppliedAt: new Date() } },
      );
      return;
    }
    // Nothing was ever really dispatched (e.g. method_not_available) —
    // no real provider attempt happened, so there is nothing to bill.
    if (!verification.callTrunkId && !verification.smsDid && !verification.emailSent) return;

    const otpType = otpChargeTypeFor[verification.type];
    // `email_code` has no country dimension at all (see `EmailRateSchema`'s
    // doc comment) — never attempt to parse an email address as an E.164
    // number here.
    const country = verification.type === "email_code" ? undefined : countryForE164(verification.targetNumber);

    // Fixed at creation time by `UsageQuotaService#tryConsumeFreeQuota` (see
    // `backend/packages/api/src/usage-quota-service.ts`) — always $0, but still writes a
    // real ledger row (never skipped) so free-quota usage is fully visible
    // in the same ledger/reports every real charge appears in, per the
    // user's explicit requirement.
    if (verification.freeQuotaCovered) {
      await this.#applyCharge(verification, {
        userId: verification.customerId,
        projectId: verification.projectId,
        interactionId: verification._id,
        type: otpType,
        country,
        amountUsd: 0,
        note: "free_quota",
      });
      return;
    }

    if (verification.type === "sms_code") {
      await this.#applyCharge(verification, {
        userId: verification.customerId,
        projectId: verification.projectId,
        interactionId: verification._id,
        type: otpType,
        country,
        amountUsd: async (tier) => {
          if (!country) return 0;
          const rate = await this.rates.smsRateFor(country);
          if (!rate) return 0;
          return -rate[`${tier}PerMessageUsd`];
        },
      });
      return;
    }

    if (verification.type === "email_code") {
      // Flat global rate, no country dimension — see `EmailRateSchema`'s
      // doc comment in `backend/packages/contracts/src/billing.ts`.
      await this.#applyCharge(verification, {
        userId: verification.customerId,
        projectId: verification.projectId,
        interactionId: verification._id,
        type: otpType,
        amountUsd: async (tier) => {
          const rate = await this.rates.emailRateFor();
          if (!rate) return 0;
          return -rate[`${tier}PerEmailUsd`];
        },
      });
      return;
    }

    const events = await this.#events
      .find({ interactionId: verification._id })
      .sort({ sequence: 1 })
      .toArray();
    const timeline = events.at(-1)?.sequence === verification.sequence
      ? events
      : [
          ...events,
          { state: verification.state, occurredAt: verification.updatedAt },
        ];
    const minutes = computeBillableMinutes(timeline);

    await this.#applyCharge(verification, {
      userId: verification.customerId,
      projectId: verification.projectId,
      interactionId: verification._id,
      type: otpType,
      country,
      amountUsd: async (tier) => {
        if (minutes <= 0 || !country) return 0;
        const rate = await this.rates.callRateFor(country);
        if (!rate) return 0;
        return -rate[`${tier}PerMinuteUsd`] * minutes;
      },
    });
  }
}
