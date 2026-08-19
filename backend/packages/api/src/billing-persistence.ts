import type { BillingTier, FinancialTransactionType, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

/** Admin-entered per-country, per-tier call rate (USD/minute) — `_id` is the
 * ISO 3166-1 alpha-2 country code. Shared by all three voice verification
 * types; see `docs/AS_BUILT.md`'s "Customer balance billing" section. */
export interface CallRateCardDocument {
  _id: string;
  tier1PerMinuteUsd: number;
  tier2PerMinuteUsd: number;
  tier3PerMinuteUsd: number;
  updatedAt: Date;
}

/** Same shape as `CallRateCardDocument`, per SMS message, for `sms_code`. */
export interface SmsRateCardDocument {
  _id: string;
  tier1PerMessageUsd: number;
  tier2PerMessageUsd: number;
  tier3PerMessageUsd: number;
  updatedAt: Date;
}

/** `email_code`'s rate, per tier — always exactly one document at the
 * fixed `_id` below, never per-country (see `EmailRateSchema`'s doc
 * comment in `backend/packages/contracts/src/billing.ts` for why). */
export interface EmailRateCardDocument {
  _id: "global";
  tier1PerEmailUsd: number;
  tier2PerEmailUsd: number;
  tier3PerEmailUsd: number;
  updatedAt: Date;
}

export const EMAIL_RATE_CARD_ID = "global" as const;

/** Exactly 3 documents, `_id` = the tier. Both fields are independently
 * admin-entered — `dailyChargedUsd` is never derived from
 * `monthlyDisplayUsd` by dividing by 30. */
export interface PlanChargeDocument {
  _id: BillingTier;
  monthlyDisplayUsd: number;
  dailyChargedUsd: number;
  updatedAt: Date;
}

/** A materialized cache of "closing balance of the last ledger row" for
 * fast reads — `_id` is the customer's `userId`. Always written in the same
 * Mongo transaction as the ledger insert that changes it (see
 * `backend/packages/api/src/balance-service.ts#applyLedgerEntry`), never independently. */
export interface CustomerBalanceDocument {
  _id: string;
  balanceUsd: number;
  tier: BillingTier;
  updatedAt: Date;
}

/**
 * The append-only financial ledger — never updated or deleted once written.
 * `amountUsd` is signed (negative=charge, positive=credit); every row
 * carries its own opening/closing balance so any date-range total is
 * independently verifiable without recomputing anything.
 */
export interface FinancialTransactionDocument {
  _id: string;
  userId: string;
  projectId?: string;
  interactionId?: string;
  sessionId?: string;
  paymentProcessor?: string;
  paymentProcessorTransactionId?: string;
  /** Historical Stripe rows written before generic processor identity shipped. */
  stripePaymentId?: string;
  sourceTransactionId?: string;
  adPayoutId?: string;
  adSettlementId?: string;
  thresholdRuleId?: string;
  referralCode?: string;
  commissionPercent?: number;
  commissionBaseUsd?: number;
  idempotencyKey?: string;
  type: FinancialTransactionType | "otp1" | "otp2" | "otp3" | "otp4" | "otp5";
  country?: string;
  /** A short annotation — the admin's stated reason for `admin_adjustment`
   * rows, or the literal `"free_quota"` for a free-quota-covered OTP row. */
  note?: string;
  openingBalanceUsd: number;
  tierAtTransaction: BillingTier;
  amountUsd: number;
  closingBalanceUsd: number;
  createdAt: Date;
}

export interface BillingIdempotencyClaimDocument {
  _id: string;
  createdAt: Date;
}

export const legacyOtpTypeMap: Record<`otp${1 | 2 | 3 | 4 | 5}`, VerificationType> = {
  otp1: "call_reachability",
  otp2: "voice_code",
  otp3: "voice_challenge",
  otp4: "sms_code",
  otp5: "email_code",
};

/** Keyed by Stripe's own event id — makes webhook delivery idempotent,
 * since Stripe retries on any non-2xx response and this must never
 * double-credit a top-up. 90-day TTL: only needed long enough to dedupe
 * retries, not a billing record itself (the ledger row is the record). */
export interface ProcessedStripeEventDocument {
  _id: string;
  processedAt: Date;
}

const PROCESSED_STRIPE_EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;

export async function ensureBillingIndexes(db: Db) {
  await Promise.all([
    db
      .collection<FinancialTransactionDocument>("financialTransactions")
      .createIndex({ userId: 1, createdAt: -1 }),
    db
      .collection<FinancialTransactionDocument>("financialTransactions")
      .createIndex({ projectId: 1, createdAt: -1 }),
    db
      .collection<FinancialTransactionDocument>("financialTransactions")
      .createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true }),
    db
      .collection<ProcessedStripeEventDocument>("processedStripeEvents")
      .createIndex({ processedAt: 1 }, { expireAfterSeconds: PROCESSED_STRIPE_EVENT_TTL_SECONDS }),
  ]);
}
