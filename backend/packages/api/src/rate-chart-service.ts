import type {
  BillingTier,
  CallRateCard,
  EmailRate,
  PlanCharge,
  SmsRateCard,
  UpdatePlanCharge,
  UpsertCallRateCard,
  UpsertEmailRate,
  UpsertSmsRateCard,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  EMAIL_RATE_CARD_ID,
  type CallRateCardDocument,
  type EmailRateCardDocument,
  type PlanChargeDocument,
  type SmsRateCardDocument,
} from "./billing-persistence.js";

/**
 * Admin CRUD over the per-country call/SMS rate charts and the per-tier
 * monthly/daily plan charge chart — see `docs/AS_BUILT.md`'s "Customer
 * balance billing" section. Purely a data store; the actual customer
 * dollar amounts VoIP.ms itself publishes per country are gathered and
 * entered by an admin, never fetched automatically from VoIP.ms.
 */
export class RateChartService {
  readonly #callRates;
  readonly #smsRates;
  readonly #emailRate;
  readonly #planCharges;

  constructor(db: Db) {
    this.#callRates = db.collection<CallRateCardDocument>("callRateCards");
    this.#smsRates = db.collection<SmsRateCardDocument>("smsRateCards");
    this.#emailRate = db.collection<EmailRateCardDocument>("emailRateCards");
    this.#planCharges = db.collection<PlanChargeDocument>("planCharges");
  }

  async listCallRates(): Promise<CallRateCard[]> {
    const rows = await this.#callRates.find().sort({ _id: 1 }).toArray();
    return rows.map(toCallRateCard);
  }

  async listSmsRates(): Promise<SmsRateCard[]> {
    const rows = await this.#smsRates.find().sort({ _id: 1 }).toArray();
    return rows.map(toSmsRateCard);
  }

  async listPlanCharges(): Promise<PlanCharge[]> {
    const rows = await this.#planCharges.find().sort({ _id: 1 }).toArray();
    return rows.map(toPlanCharge);
  }

  /** `null` before an admin has ever set it — same "no guessed default"
   * convention as `callRateFor`/`smsRateFor` below. */
  async getEmailRate(): Promise<EmailRate | null> {
    const row = await this.#emailRate.findOne({ _id: EMAIL_RATE_CARD_ID });
    return row ? toEmailRate(row) : null;
  }

  async upsertCallRate(input: UpsertCallRateCard): Promise<CallRateCard> {
    const now = new Date();
    await this.#callRates.updateOne(
      { _id: input.countryCode },
      {
        $set: {
          tier1PerMinuteUsd: input.tier1PerMinuteUsd,
          tier2PerMinuteUsd: input.tier2PerMinuteUsd,
          tier3PerMinuteUsd: input.tier3PerMinuteUsd,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    return { ...input, updatedAt: now.toISOString() };
  }

  async upsertSmsRate(input: UpsertSmsRateCard): Promise<SmsRateCard> {
    const now = new Date();
    await this.#smsRates.updateOne(
      { _id: input.countryCode },
      {
        $set: {
          tier1PerMessageUsd: input.tier1PerMessageUsd,
          tier2PerMessageUsd: input.tier2PerMessageUsd,
          tier3PerMessageUsd: input.tier3PerMessageUsd,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    return { ...input, updatedAt: now.toISOString() };
  }

  async upsertEmailRate(input: UpsertEmailRate): Promise<EmailRate> {
    const now = new Date();
    await this.#emailRate.updateOne(
      { _id: EMAIL_RATE_CARD_ID },
      {
        $set: {
          tier1PerEmailUsd: input.tier1PerEmailUsd,
          tier2PerEmailUsd: input.tier2PerEmailUsd,
          tier3PerEmailUsd: input.tier3PerEmailUsd,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    return { ...input, updatedAt: now.toISOString() };
  }

  async updatePlanCharge(input: UpdatePlanCharge): Promise<PlanCharge> {
    const now = new Date();
    await this.#planCharges.updateOne(
      { _id: input.tier },
      {
        $set: {
          monthlyDisplayUsd: input.monthlyDisplayUsd,
          dailyChargedUsd: input.dailyChargedUsd,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    return { ...input, updatedAt: now.toISOString() };
  }

  /** Looked up at charge time by `backend/packages/api/src/billing-charge-service.ts` —
   * `undefined` (no entry for this country yet) means "nothing to charge",
   * never a guessed default rate. */
  async callRateFor(countryCode: string): Promise<CallRateCardDocument | null> {
    return this.#callRates.findOne({ _id: countryCode });
  }

  async smsRateFor(countryCode: string): Promise<SmsRateCardDocument | null> {
    return this.#smsRates.findOne({ _id: countryCode });
  }

  async planChargeFor(tier: BillingTier): Promise<PlanChargeDocument | null> {
    return this.#planCharges.findOne({ _id: tier });
  }

  /** Looked up at charge time by `backend/packages/api/src/billing-charge-service.ts`
   * for `email_code` — same "no guessed default" convention as
   * `callRateFor`/`smsRateFor`. */
  async emailRateFor(): Promise<EmailRateCardDocument | null> {
    return this.#emailRate.findOne({ _id: EMAIL_RATE_CARD_ID });
  }
}

function toCallRateCard(document: CallRateCardDocument): CallRateCard {
  return {
    countryCode: document._id,
    tier1PerMinuteUsd: document.tier1PerMinuteUsd,
    tier2PerMinuteUsd: document.tier2PerMinuteUsd,
    tier3PerMinuteUsd: document.tier3PerMinuteUsd,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toSmsRateCard(document: SmsRateCardDocument): SmsRateCard {
  return {
    countryCode: document._id,
    tier1PerMessageUsd: document.tier1PerMessageUsd,
    tier2PerMessageUsd: document.tier2PerMessageUsd,
    tier3PerMessageUsd: document.tier3PerMessageUsd,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toPlanCharge(document: PlanChargeDocument): PlanCharge {
  return {
    tier: document._id,
    monthlyDisplayUsd: document.monthlyDisplayUsd,
    dailyChargedUsd: document.dailyChargedUsd,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toEmailRate(document: EmailRateCardDocument): EmailRate {
  return {
    tier1PerEmailUsd: document.tier1PerEmailUsd,
    tier2PerEmailUsd: document.tier2PerEmailUsd,
    tier3PerEmailUsd: document.tier3PerEmailUsd,
    updatedAt: document.updatedAt.toISOString(),
  };
}
