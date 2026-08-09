import type {
  BillingTier,
  CallRateCard,
  PlanCharge,
  SmsRateCard,
  UpdatePlanCharge,
  UpsertCallRateCard,
  UpsertSmsRateCard,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import type {
  CallRateCardDocument,
  PlanChargeDocument,
  SmsRateCardDocument,
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
  readonly #planCharges;

  constructor(db: Db) {
    this.#callRates = db.collection<CallRateCardDocument>("callRateCards");
    this.#smsRates = db.collection<SmsRateCardDocument>("smsRateCards");
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

  /** Looked up at charge time by `apps/api/src/billing-charge-service.ts` —
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
