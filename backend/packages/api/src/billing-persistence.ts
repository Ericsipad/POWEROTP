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
  paymentProcessorEventId?: string;
  paymentRequestId?: string;
  sourceTransactionId?: string;
  referralProcessed?: true;
  referralTransactionId?: string;
  adPayoutId?: string;
  adSettlementId?: string;
  thresholdRuleId?: string;
  referralCode?: string;
  commissionPercent?: number;
  commissionBaseUsd?: number;
  type: FinancialTransactionType;
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

export interface TopupRequestDocument {
  _id: string;
  userId: string;
  amountUsd: number;
  paymentProcessor: string;
  processorCheckoutSessionId?: string;
  processorTransactionId?: string;
  status: "creating" | "pending" | "completed" | "failed";
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface PaymentProcessorEventDocument {
  _id: string;
  paymentProcessor: string;
  eventId: string;
  eventType: string;
  status: "received" | "processed" | "ignored" | "failed";
  topupRequestId?: string;
  processorCheckoutSessionId?: string;
  processorTransactionId?: string;
  processorPaymentStatus?: string;
  amountUsd?: number;
  currency?: string;
  processorCreatedAt?: Date;
  livemode?: boolean;
  failureReason?: string;
  receivedAt: Date;
  processedAt?: Date;
}

export async function ensureBillingIndexes(db: Db) {
  const ledger = db.collection<FinancialTransactionDocument>("financialTransactions");
  await Promise.all([
    ledger.createIndex({ userId: 1, createdAt: -1 }),
    ledger.createIndex({ projectId: 1, createdAt: -1 }),
    ledger.createIndex({ userId: 1, type: 1 }),
  ]);
  await ledger.createIndex(
    { paymentProcessor: 1, paymentProcessorTransactionId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        paymentProcessor: { $type: "string" },
        paymentProcessorTransactionId: { $type: "string" },
      },
    },
  );
  await db
    .collection<TopupRequestDocument>("topupRequests")
    .createIndex(
      { paymentProcessor: 1, processorCheckoutSessionId: 1 },
      {
        unique: true,
        partialFilterExpression: { processorCheckoutSessionId: { $type: "string" } },
      },
    );
}
