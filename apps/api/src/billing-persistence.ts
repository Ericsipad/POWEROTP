import type { BillingTier, FinancialTransactionType } from "@powerotp/contracts";
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
 * `apps/api/src/balance-service.ts#applyLedgerEntry`), never independently. */
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
  stripePaymentId?: string;
  type: FinancialTransactionType;
  country?: string;
  openingBalanceUsd: number;
  tierAtTransaction: BillingTier;
  amountUsd: number;
  closingBalanceUsd: number;
  createdAt: Date;
}

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
      .collection<ProcessedStripeEventDocument>("processedStripeEvents")
      .createIndex({ processedAt: 1 }, { expireAfterSeconds: PROCESSED_STRIPE_EVENT_TTL_SECONDS }),
  ]);
}
