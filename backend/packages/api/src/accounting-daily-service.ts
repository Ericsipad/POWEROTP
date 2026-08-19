import type { Db } from "mongodb";

import { AdPayoutSettlementService } from "./ad-payout-settlement-service.js";
import type {
  BillingThresholdRuleDocument,
  ProjectAuthSessionDocument,
  ProjectReferralAttributionDocument,
  ProjectThresholdChargeStateDocument,
  ReferralCommissionSettingsDocument,
} from "./accounting-persistence.js";
import type { BalanceService, LedgerEntryInput } from "./balance-service.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type AuditDocument,
  type ProjectDocument,
} from "./persistence.js";
import type { RateChartService } from "./rate-chart-service.js";
import { createSortableId } from "./security.js";

const DAY_MS = 86_400_000;
const THRESHOLD_COOLDOWN_MS = 31 * DAY_MS;

class ThresholdNoLongerEligibleError extends Error {}

export { serviceDayBounds } from "./ad-payout-settlement-service.js";

export function isThresholdEligible(
  count: number,
  thresholdCount: number,
  lastChargedAt: Date | undefined,
  now: Date,
): boolean {
  return (
    count >= thresholdCount &&
    (!lastChargedAt || now.getTime() - lastChargedAt.getTime() >= THRESHOLD_COOLDOWN_MS)
  );
}

function commissionInput(
  referrerUserId: string,
  projectId: string,
  referralCode: string,
  percent: number,
  sourceEntryIndex: number,
): LedgerEntryInput | undefined {
  if (percent <= 0) return undefined;
  return {
    userId: referrerUserId,
    projectId,
    type: "referral_commission",
    amountUsd: (_tier, entries) =>
      Math.abs(entries[sourceEntryIndex]?.amountUsd ?? 0) * percent / 100,
    sourceEntryIndex,
    referralCode,
    commissionPercent: percent,
    omitWhenZero: true,
  };
}

export class AccountingDailyService {
  readonly #projects;
  readonly #sessions;
  readonly #thresholds;
  readonly #thresholdStates;
  readonly #projectReferrals;
  readonly #commissions;
  readonly #audits;
  readonly #adPayouts;

  constructor(
    db: Db,
    private readonly balances: BalanceService,
    private readonly rates: RateChartService,
  ) {
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#sessions = db.collection<ProjectAuthSessionDocument>("projectAuthSessions");
    this.#thresholds = db.collection<BillingThresholdRuleDocument>("billingThresholdRules");
    this.#thresholdStates =
      db.collection<ProjectThresholdChargeStateDocument>("projectThresholdChargeStates");
    this.#projectReferrals =
      db.collection<ProjectReferralAttributionDocument>("projectReferralAttributions");
    this.#commissions =
      db.collection<ReferralCommissionSettingsDocument>("referralCommissionSettings");
    this.#audits = db.collection<AuditDocument>("auditEvents");
    this.#adPayouts = new AdPayoutSettlementService(db, balances);
  }

  async run(now = new Date()): Promise<void> {
    await this.#adPayouts.settleEntered(now);
    await this.#chargeThresholds(now);
    await this.#chargeDailyProjects(now);
  }

  async #chargeThresholds(now: Date) {
    const [projects, rules, settings] = await Promise.all([
      this.#projects.find({ active: true }).toArray(),
      this.#thresholds.find({ active: true }).sort({ thresholdCount: 1 }).toArray(),
      this.#commissions.findOne({ _id: "global" }),
    ]);
    const since = new Date(now.getTime() - 30 * DAY_MS);
    for (const project of projects) {
      if (project.customerId === PLATFORM_ADMIN_USER_ID) continue;
      const referral = await this.#projectReferrals.findOne({
        projectId: project._id,
        endedAt: { $exists: false },
      });
      for (const rule of rules) {
        const count = await this.#sessions.countDocuments({
          projectId: project._id,
          eventType: rule.eventType,
          occurredAt: { $gte: since, $lte: now },
        });
        const state = await this.#thresholdStates.findOne({
          projectId: project._id,
          thresholdRuleId: rule._id,
        });
        if (!isThresholdEligible(count, rule.thresholdCount, state?.lastChargedAt, now)) continue;
        const type = rule.eventType === "signup" ? "signup_threshold_charge" : "signin_threshold_charge";
        const entries: LedgerEntryInput[] = [{
          userId: project.customerId,
          projectId: project._id,
          type,
          thresholdRuleId: rule._id,
          amountUsd: (tier) => -rule[`${tier}ChargeUsd`],
        }];
        const percent = rule.eventType === "signup"
          ? settings?.signupChargePercent
          : settings?.signinChargePercent;
        const commission = referral && percent !== undefined
          ? commissionInput(referral.referrerUserId, project._id, referral.referralCode, percent, 0)
          : undefined;
        if (commission) entries.push({ ...commission, thresholdRuleId: rule._id });
        try {
          await this.balances.applyLedgerEntries(
            entries,
            `threshold:${project._id}:${rule._id}:${now.toISOString().slice(0, 10)}`,
            async (ledgerRows, session) => {
              const currentState = await this.#thresholdStates.findOne(
                { projectId: project._id, thresholdRuleId: rule._id },
                { session },
              );
              if (
                !isThresholdEligible(
                  count,
                  rule.thresholdCount,
                  currentState?.lastChargedAt,
                  now,
                )
              ) {
                throw new ThresholdNoLongerEligibleError();
              }
              const sourceRow = ledgerRows[0];
              if (!sourceRow) throw new Error("threshold_source_row_missing");
              await this.#thresholdStates.updateOne(
                { projectId: project._id, thresholdRuleId: rule._id },
                {
                  $set: {
                    lastChargedAt: now,
                    observedCount: count,
                    tierAtCharge: sourceRow.tierAtTransaction,
                    ledgerTransactionId: sourceRow._id,
                  },
                  $setOnInsert: { _id: createSortableId("tcs"), projectId: project._id, thresholdRuleId: rule._id },
                },
                { upsert: true, session },
              );
            },
          );
        } catch (error) {
          if (error instanceof ThresholdNoLongerEligibleError) continue;
          await this.#recordFailure("threshold charge failed", project._id, error);
        }
      }
    }
  }

  async #chargeDailyProjects(now: Date) {
    const [projects, settings] = await Promise.all([
      this.#projects.find({ active: true }).toArray(),
      this.#commissions.findOne({ _id: "global" }),
    ]);
    const serviceDate = now.toISOString().slice(0, 10);
    for (const project of projects) {
      if (project.customerId === PLATFORM_ADMIN_USER_ID) continue;
      const referral = await this.#projectReferrals.findOne({
        projectId: project._id,
        endedAt: { $exists: false },
      });
      const entries: LedgerEntryInput[] = [{
        userId: project.customerId,
        projectId: project._id,
        type: "daily_charge",
        amountUsd: async (tier) => {
          const plan = await this.rates.planChargeFor(tier);
          return plan ? -plan.dailyChargedUsd : 0;
        },
      }];
      const commission = referral && settings
        ? commissionInput(
            referral.referrerUserId,
            project._id,
            referral.referralCode,
            settings.recurringChargePercent,
            0,
          )
        : undefined;
      if (commission) entries.push(commission);
      try {
        await this.balances.applyLedgerEntries(
          entries,
          `daily-charge:${project._id}:${serviceDate}`,
        );
      } catch (error) {
        await this.#recordFailure("daily charge failed", project._id, error);
      }
    }
  }

  async #recordFailure(message: string, targetId: string, error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error(JSON.stringify({
      service: "powerotp-api",
      component: "daily-accounting",
      msg: message,
      targetId,
      error: reason,
    }));
    await this.#audits.insertOne({
      _id: createSortableId("aud"),
      actorId: "system:daily-accounting",
      action: "accounting.worker.failed",
      targetType: "accounting_operation",
      targetId,
      occurredAt: new Date(),
      details: { message, reason },
    });
  }
}
