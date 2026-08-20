import type {
  AdDailyPayoutInput,
  BillingThresholdRuleInput,
  ReferralCommissionSettingsInput,
  UpsertAdSystem,
} from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

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

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
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

  constructor(
    private readonly client: Pick<MongoClient, "startSession">,
    db: Db,
  ) {
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
    return this.#transaction(async (session) => {
      const now = new Date();
      await this.#adSystems.updateOne(
        { _id: input.id },
        {
          $set: { displayName: input.displayName, active: input.active, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true, session },
      );
      await this.#audit(actorId, "accounting.ad_system.saved", "ad_system", input.id, session);
      const document = await this.#adSystems.findOne({ _id: input.id }, { session });
      if (!document) throw new Error("ad_system_write_failed");
      return document;
    });
  }

  async savePayout(actorId: string, input: AdDailyPayoutInput): Promise<AdDailyPayoutDocument> {
    if (!completeServiceDates().includes(input.serviceDate)) {
      throw new AccountingConfigError("payout_date_outside_entry_window", 400);
    }
    return this.#transaction(async (session) => {
      const system = await this.#adSystems.findOne({ _id: input.adSystemId }, { session });
      if (!system) throw new AccountingConfigError("ad_system_not_found", 404);
      const existing = await this.#payouts.findOne(
        { adSystemId: input.adSystemId, serviceDate: input.serviceDate },
        { session },
      );
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
      const result = await this.#payouts.replaceOne(
        existing
          ? { _id: existing._id, status: { $ne: "settled" } }
          : { adSystemId: input.adSystemId, serviceDate: input.serviceDate },
        document,
        { upsert: !existing, session },
      );
      if (existing && result.matchedCount !== 1) {
        throw new AccountingConfigError("payout_already_settled", 409);
      }
      await this.#audit(
        actorId,
        "accounting.ad_payout.saved",
        "ad_daily_payout",
        document._id,
        session,
      );
      return document;
    });
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
    try {
      return await this.#transaction(async (session) => {
        await this.#thresholds.insertOne(document, { session });
        await this.#audit(
          actorId,
          "accounting.threshold.created",
          "billing_threshold",
          document._id,
          session,
        );
        return document;
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AccountingConfigError("threshold_already_exists", 409);
      }
      throw error;
    }
  }

  async updateThreshold(
    actorId: string,
    ruleId: string,
    input: Omit<BillingThresholdRuleInput, "eventType" | "thresholdCount">,
  ): Promise<BillingThresholdRuleDocument> {
    return this.#transaction(async (session) => {
      const updated = await this.#thresholds.findOneAndUpdate(
        { _id: ruleId },
        { $set: { ...input, updatedAt: new Date() } },
        { returnDocument: "after", session },
      );
      if (!updated) throw new AccountingConfigError("threshold_not_found", 404);
      await this.#audit(
        actorId,
        "accounting.threshold.updated",
        "billing_threshold",
        ruleId,
        session,
      );
      return updated;
    });
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
    return this.#transaction(async (session) => {
      await this.#commissions.replaceOne({ _id: "global" }, document, { upsert: true, session });
      await this.#audit(
        actorId,
        "accounting.commissions.updated",
        "referral_commissions",
        "global",
        session,
      );
      return document;
    });
  }

  async #transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession() as ClientSession;
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }

  async #audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    session: ClientSession,
  ) {
    await this.#audits.insertOne(
      {
        _id: createSortableId("aud"),
        actorId,
        action,
        targetType,
        targetId,
        occurredAt: new Date(),
      },
      { session },
    );
  }
}

export { completeServiceDates };
