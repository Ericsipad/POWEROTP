import type { BillingTier, ProjectAuthEventType } from "@powerotp/contracts";
import type { Collection, Db, Document } from "mongodb";

export interface ProjectAuthSessionDocument {
  _id: string;
  projectId: string;
  customerId: string;
  eventType: ProjectAuthEventType;
  occurredAt: Date;
  adSlotsAllotted: number;
  adSlotsFilled: number;
  adSystemId: string;
  idempotencyKey: string;
  reportedAt: Date;
}

export interface AdSystemDocument {
  _id: string;
  displayName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdDailyPayoutDocument {
  _id: string;
  adSystemId: string;
  serviceDate: string;
  grossPayoutMicros: number;
  enteredBy: string;
  enteredAt: Date;
  updatedAt: Date;
  status: "entered" | "settled" | "failed";
  totalFilledSlots?: number;
  failureReason?: string;
  settledAt?: Date;
}

export interface AdDailySettlementDocument {
  _id: string;
  adPayoutId: string;
  projectId: string;
  customerId: string;
  adSystemId: string;
  serviceDate: string;
  periodStart: Date;
  periodEnd: Date;
  projectFilledSlots: number;
  totalFilledSlots: number;
  allocatedGrossMicros: number;
  ownerTransactionId: string;
  referralTransactionId?: string;
  createdAt: Date;
}

export interface BillingThresholdRuleDocument {
  _id: string;
  eventType: ProjectAuthEventType;
  thresholdCount: number;
  tier1ChargeUsd: number;
  tier2ChargeUsd: number;
  tier3ChargeUsd: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectThresholdChargeStateDocument {
  _id: string;
  projectId: string;
  thresholdRuleId: string;
  lastChargedAt: Date;
  observedCount: number;
  tierAtCharge: BillingTier;
  ledgerTransactionId: string;
}

export interface ReferralCodeDocument {
  _id: string;
  ownerUserId: string;
  active: boolean;
  createdAt: Date;
  disabledAt?: Date;
}

export interface AccountReferralAttributionDocument {
  _id: string;
  referralCode: string;
  referrerUserId: string;
  attributedAt: Date;
}

export interface ProjectReferralAttributionDocument {
  _id: string;
  projectId: string;
  referralCode: string;
  referrerUserId: string;
  startedAt: Date;
  endedAt?: Date;
  setBy: string;
}

export interface ReferralCommissionSettingsDocument {
  _id: "global";
  signupChargePercent: number;
  signinChargePercent: number;
  adDepositPercent: number;
  recurringChargePercent: number;
  updatedAt: Date;
  updatedBy: string;
}

async function dropNonUniqueIndex<T extends Document>(
  collection: Collection<T>,
  indexName: string,
): Promise<void> {
  try {
    const index = (await collection.listIndexes().toArray())
      .find((candidate) => candidate.name === indexName);
    if (index && !index.unique) await collection.dropIndex(indexName);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== 26
    ) {
      throw error;
    }
  }
}

export async function ensureAccountingIndexes(db: Db): Promise<void> {
  const thresholds = db.collection<BillingThresholdRuleDocument>("billingThresholdRules");
  const referralCodes = db.collection<ReferralCodeDocument>("referralCodes");
  await Promise.all([
    dropNonUniqueIndex(thresholds, "eventType_1_thresholdCount_1"),
    dropNonUniqueIndex(referralCodes, "ownerUserId_1"),
  ]);
  await Promise.all([
    db
      .collection<ProjectAuthSessionDocument>("projectAuthSessions")
      .createIndex({ projectId: 1, occurredAt: -1, eventType: 1 }),
    db
      .collection<ProjectAuthSessionDocument>("projectAuthSessions")
      .createIndex({ projectId: 1, idempotencyKey: 1 }, { unique: true }),
    db
      .collection<AdDailyPayoutDocument>("adDailyPayouts")
      .createIndex({ adSystemId: 1, serviceDate: 1 }, { unique: true }),
    db
      .collection<AdDailyPayoutDocument>("adDailyPayouts")
      .createIndex({ status: 1, serviceDate: 1 }),
    db
      .collection<AdDailySettlementDocument>("adDailySettlements")
      .createIndex({ projectId: 1, adSystemId: 1, serviceDate: 1 }, { unique: true }),
    thresholds.createIndex({ eventType: 1, thresholdCount: 1 }, { unique: true }),
    db
      .collection<ProjectThresholdChargeStateDocument>("projectThresholdChargeStates")
      .createIndex({ projectId: 1, thresholdRuleId: 1 }, { unique: true }),
    referralCodes.createIndex(
      { ownerUserId: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    ),
    db
      .collection<ProjectReferralAttributionDocument>("projectReferralAttributions")
      .createIndex(
        { projectId: 1 },
        { unique: true, partialFilterExpression: { endedAt: { $exists: false } } },
      ),
  ]);
}
