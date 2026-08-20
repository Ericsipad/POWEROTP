import type { Db } from "mongodb";

import { completeServiceDates } from "./accounting-config-service.js";
import { allocatePayoutMicros, microsToUsd } from "./accounting-money.js";
import type {
  AdDailyPayoutDocument,
  AdDailySettlementDocument,
  AdSystemDocument,
  ProjectAuthSessionDocument,
  ProjectReferralAttributionDocument,
  ReferralCommissionSettingsDocument,
} from "./accounting-persistence.js";
import type { BalanceService, LedgerEntryInput } from "./balance-service.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type AuditDocument,
  type ProjectDocument,
} from "./persistence.js";
import { createSortableId } from "./security.js";

const DAY_MS = 86_400_000;

export function serviceDayBounds(serviceDate: string) {
  const start = new Date(`${serviceDate}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export class AdPayoutSettlementService {
  readonly #projects;
  readonly #sessions;
  readonly #payouts;
  readonly #settlements;
  readonly #adSystems;
  readonly #projectReferrals;
  readonly #commissions;
  readonly #audits;

  constructor(
    db: Db,
    private readonly balances: BalanceService,
  ) {
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#sessions = db.collection<ProjectAuthSessionDocument>("projectAuthSessions");
    this.#payouts = db.collection<AdDailyPayoutDocument>("adDailyPayouts");
    this.#settlements = db.collection<AdDailySettlementDocument>("adDailySettlements");
    this.#adSystems = db.collection<AdSystemDocument>("adSystems");
    this.#projectReferrals =
      db.collection<ProjectReferralAttributionDocument>("projectReferralAttributions");
    this.#commissions =
      db.collection<ReferralCommissionSettingsDocument>("referralCommissionSettings");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async settleEntered(now: Date): Promise<boolean> {
    const payouts = await this.#payouts
      .find({ serviceDate: { $in: completeServiceDates(now) }, status: { $in: ["entered", "failed"] } })
      .sort({ serviceDate: 1, adSystemId: 1 })
      .toArray();
    const settings = await this.#commissions.findOne({ _id: "global" });
    let failed = false;
    for (const payout of payouts) {
      try {
        await this.#settleOne(payout, settings, now);
      } catch (error) {
        failed = true;
        await this.#payouts.updateOne(
          { _id: payout._id, status: { $ne: "settled" } },
          {
            $set: {
              status: "failed",
              failureReason: error instanceof Error ? error.message : "settlement_failed",
            },
          },
        );
        await this.#recordFailure(payout._id, error);
      }
    }
    return failed;
  }

  async #settleOne(
    payout: AdDailyPayoutDocument,
    settings: ReferralCommissionSettingsDocument | null,
    now: Date,
  ) {
    const system = await this.#adSystems.findOne({ _id: payout.adSystemId, active: true });
    if (!system) throw new Error("ad_system_unavailable");
    const { start, end } = serviceDayBounds(payout.serviceDate);
    const grouped = await this.#sessions
      .aggregate<{ _id: string; filledSlots: number }>([
        { $match: { adSystemId: payout.adSystemId, occurredAt: { $gte: start, $lt: end } } },
        { $group: { _id: "$projectId", filledSlots: { $sum: "$adSlotsFilled" } } },
      ])
      .toArray();
    const projects = await this.#projects
      .find({ _id: { $in: grouped.map((row) => row._id) } })
      .toArray();
    const projectById = new Map(projects.map((project) => [project._id, project]));
    if (grouped.some((row) => !projectById.has(row._id))) throw new Error("project_not_found");
    const billableShares = grouped
      .filter((row) => projectById.get(row._id)?.customerId !== PLATFORM_ADMIN_USER_ID)
      .map((row) => ({ projectId: row._id, filledSlots: row.filledSlots }));
    if (billableShares.some((row) => !Number.isSafeInteger(row.filledSlots) || row.filledSlots < 0)) {
      throw new Error("filled_slots_too_large");
    }
    const totalFilledSlotsBigInt = billableShares
      .reduce((sum, row) => sum + BigInt(row.filledSlots), 0n);
    if (totalFilledSlotsBigInt === 0n) throw new Error("no_filled_slots");
    if (totalFilledSlotsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("filled_slots_too_large");
    }
    const totalFilledSlots = Number(totalFilledSlotsBigInt);
    const allocations = allocatePayoutMicros(payout.grossPayoutMicros, billableShares);
    const referrals = await this.#projectReferrals
      .find({ projectId: { $in: allocations.map((row) => row.projectId) }, endedAt: { $exists: false } })
      .toArray();
    const referralByProject = new Map(referrals.map((row) => [row.projectId, row]));
    const entries: LedgerEntryInput[] = [];
    const metadata: Array<{
      settlementId: string;
      allocation: (typeof allocations)[number];
      ownerIndex: number;
      referralIndex?: number;
    }> = [];
    for (const allocation of allocations) {
      const project = projectById.get(allocation.projectId);
      if (!project) throw new Error("project_not_found");
      const settlementId = createSortableId("ads");
      const ownerIndex = entries.length;
      entries.push({
        userId: project.customerId,
        projectId: project._id,
        type: "ad_revenue",
        amountUsd: microsToUsd(allocation.allocatedMicros),
        adPayoutId: payout._id,
        adSettlementId: settlementId,
      });
      const referral = referralByProject.get(project._id);
      const commissionMicros = settings
        ? Math.round(allocation.allocatedMicros * settings.adDepositPercent / 100)
        : 0;
      let referralIndex: number | undefined;
      if (referral && settings && commissionMicros > 0) {
        referralIndex = entries.length;
        entries.push({
          userId: referral.referrerUserId,
          projectId: project._id,
          type: "ad_revenue_referral_credit",
          amountUsd: microsToUsd(commissionMicros),
          sourceEntryIndex: ownerIndex,
          referralCode: referral.referralCode,
          commissionPercent: settings.adDepositPercent,
          adPayoutId: payout._id,
          adSettlementId: settlementId,
        });
      }
      metadata.push({ settlementId, allocation, ownerIndex, referralIndex });
    }
    await this.balances.applyLedgerEntries(
      entries,
      `ad-payout:${payout._id}`,
      async (ledgerRows, session) => {
        await this.#settlements.insertMany(
          metadata.map(({ settlementId, allocation, ownerIndex, referralIndex }) => {
            const project = projectById.get(allocation.projectId)!;
            return {
              _id: settlementId,
              adPayoutId: payout._id,
              projectId: project._id,
              customerId: project.customerId,
              adSystemId: payout.adSystemId,
              serviceDate: payout.serviceDate,
              periodStart: start,
              periodEnd: end,
              projectFilledSlots: allocation.filledSlots,
              totalFilledSlots,
              allocatedGrossMicros: allocation.allocatedMicros,
              ownerTransactionId: ledgerRows[ownerIndex]!._id,
              referralTransactionId:
                referralIndex === undefined ? undefined : ledgerRows[referralIndex]?._id,
              createdAt: now,
            };
          }),
          { session },
        );
        await this.#payouts.updateOne(
          { _id: payout._id, status: { $ne: "settled" } },
          {
            $set: { status: "settled", totalFilledSlots, settledAt: now },
            $unset: { failureReason: "" },
          },
          { session },
        );
      },
    );
  }

  async #recordFailure(targetId: string, error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error(JSON.stringify({
      service: "powerotp-api",
      component: "daily-accounting",
      msg: "ad payout settlement failed",
      targetId,
      error: reason,
    }));
    await this.#audits.insertOne({
      _id: createSortableId("aud"),
      actorId: "system:daily-accounting",
      action: "accounting.worker.failed",
      targetType: "ad_daily_payout",
      targetId,
      occurredAt: new Date(),
      details: { message: "ad payout settlement failed", reason },
    });
  }
}
