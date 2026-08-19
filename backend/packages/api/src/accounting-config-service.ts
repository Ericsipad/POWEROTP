import type {
  AdDailyPayoutInput,
  BillingThresholdRuleInput,
  ReferralCommissionSettingsInput,
  UpsertAdSystem,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import { usdDecimalToMicros } from "./accounting-money.js";
import type {
  AdDailyPayoutDocument,
  AdSystemDocument,
  BillingThresholdRuleDocument,
  ReferralCommissionSettingsDocument,
} from "./accounting-persistence.js";
import type { AuditDocument } from "./persistence.js";
import { createSortableId } from "./security.js";

export class AccountingConfigError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

function completeServiceDates(now = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 10 }, (_, index) =>
    new Date(today - (index + 1) * 86_400_000).toISOString().slice(0, 10),
  );
}

export class AccountingConfigService {
  readonly #adSystems;
  readonly #payouts;
  readonly #thresholds;
  readonly #commissions;
  readonly #audits;

  constructor(db: Db) {
    this.#adSystems = db.collection<AdSystemDocument>("adSystems");
    this.#payouts = db.collection<AdDailyPayoutDocument>("adDailyPayouts");
    this.#thresholds = db.collection<BillingThresholdRuleDocument>("billingThresholdRules");
    this.#commissions = db.collection<ReferralCommissionSettingsDocument>("referralCommissionSettings");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async list() {
    const dates = completeServiceDates();
    const [adSystems, thresholds, commissions, payouts] = await Promise.all([
      this.#adSystems.find().sort({ _id: 1 }).toArray(),
      this.#thresholds.find().sort({ eventType: 1, thresholdCount: 1 }).toArray(),
      this.#commissions.findOne({ _id: "global" }),
      this.#payouts.find({ serviceDate: { $in: dates } }).sort({ serviceDate: -1, adSystemId: 1 }).toArray(),
    ]);
    return { adSystems, thresholds, commissions, payouts, serviceDates: dates };
  }

  async upsertAdSystem(actorId: string, input: UpsertAdSystem): Promise<AdSystemDocument> {
    const now = new Date();
    await this.#adSystems.updateOne(
      { _id: input.id },
      {
        $set: { displayName: input.displayName, active: input.active, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    await this.#audit(actorId, "accounting.ad_system.saved", "ad_system", input.id);
    return (await this.#adSystems.findOne({ _id: input.id }))!;
  }

  async savePayout(actorId: string, input: AdDailyPayoutInput): Promise<AdDailyPayoutDocument> {
    if (!completeServiceDates().includes(input.serviceDate)) {
      throw new AccountingConfigError("payout_date_outside_entry_window", 400);
    }
    const system = await this.#adSystems.findOne({ _id: input.adSystemId });
    if (!system) throw new AccountingConfigError("ad_system_not_found", 404);
    const existing = await this.#payouts.findOne({
      adSystemId: input.adSystemId,
      serviceDate: input.serviceDate,
    });
    if (existing?.status === "settled") {
      throw new AccountingConfigError("payout_already_settled", 409);
    }
    const now = new Date();
    const document: AdDailyPayoutDocument = {
      _id: existing?._id ?? createSortableId("adp"),
      adSystemId: input.adSystemId,
      serviceDate: input.serviceDate,
      grossPayoutMicros: usdDecimalToMicros(input.grossPayoutUsd),
      enteredBy: actorId,
      enteredAt: existing?.enteredAt ?? now,
      updatedAt: now,
      status: "entered",
    };
    await this.#payouts.replaceOne(
      { adSystemId: input.adSystemId, serviceDate: input.serviceDate },
      document,
      { upsert: true },
    );
    await this.#audit(actorId, "accounting.ad_payout.saved", "ad_daily_payout", document._id);
    return document;
  }

  async createThreshold(
    actorId: string,
    input: BillingThresholdRuleInput,
  ): Promise<BillingThresholdRuleDocument> {
    const now = new Date();
    const document: BillingThresholdRuleDocument = {
      _id: createSortableId("btr"),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await this.#thresholds.insertOne(document);
    await this.#audit(actorId, "accounting.threshold.created", "billing_threshold", document._id);
    return document;
  }

  async updateThreshold(
    actorId: string,
    ruleId: string,
    input: Omit<BillingThresholdRuleInput, "eventType" | "thresholdCount">,
  ): Promise<BillingThresholdRuleDocument> {
    const updated = await this.#thresholds.findOneAndUpdate(
      { _id: ruleId },
      { $set: { ...input, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new AccountingConfigError("threshold_not_found", 404);
    await this.#audit(actorId, "accounting.threshold.updated", "billing_threshold", ruleId);
    return updated;
  }

  async setCommissions(
    actorId: string,
    input: ReferralCommissionSettingsInput,
  ): Promise<ReferralCommissionSettingsDocument> {
    const document: ReferralCommissionSettingsDocument = {
      _id: "global",
      ...input,
      updatedAt: new Date(),
      updatedBy: actorId,
    };
    await this.#commissions.replaceOne({ _id: "global" }, document, { upsert: true });
    await this.#audit(actorId, "accounting.commissions.updated", "referral_commissions", "global");
    return document;
  }

  async #audit(actorId: string, action: string, targetType: string, targetId: string) {
    await this.#audits.insertOne({
      _id: createSortableId("aud"),
      actorId,
      action,
      targetType,
      targetId,
      occurredAt: new Date(),
    });
  }
}

export { completeServiceDates };
