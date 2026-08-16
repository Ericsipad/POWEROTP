import type {
  BillingTier,
  CustomerBalance,
  FinancialTransaction,
  FinancialTransactionType,
} from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

import type {
  CustomerBalanceDocument,
  FinancialTransactionDocument,
} from "./billing-persistence.js";
import { roundCurrency } from "./money.js";
import { PLATFORM_ADMIN_USER_ID } from "./persistence.js";
import { createSortableId } from "./security.js";

export class BillingError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/**
 * The tier boundaries themselves are a fixed product decision, not
 * admin-configurable (only the *rates* charged per tier are — see
 * `backend/packages/api/src/rate-chart-service.ts`). Tier3 (the most money on deposit)
 * gets the cheapest rates; tier1 the most expensive.
 */
export function tierForBalance(balanceUsd: number): BillingTier {
  if (balanceUsd >= 100) return "tier3";
  if (balanceUsd >= 50) return "tier2";
  return "tier1";
}

export interface LedgerEntryInput {
  userId: string;
  type: FinancialTransactionType;
  /**
   * Either a fixed signed amount (positive=credit, e.g. a Stripe top-up) or
   * a resolver given the tier that applies to *this* transaction — the tier
   * is only known once the current balance has been read inside the
   * transaction, so a tier-dependent rate (a per-minute/per-message charge,
   * or the daily plan fee) must be resolved this way rather than computed
   * ahead of time, or a concurrent top-up/charge could make the customer's
   * tier stale by the time this entry is actually applied.
   */
  amountUsd: number | ((tier: BillingTier) => number | Promise<number>);
  projectId?: string;
  interactionId?: string;
  stripePaymentId?: string;
  country?: string;
  /** The admin's stated reason for `admin_adjustment` entries (see
   * `POST /v1/admin/billing/credit`), or the literal `"free_quota"` for a
   * free-quota-covered `otp1`..`otp4` entry (see
   * `backend/packages/api/src/billing-charge-service.ts`). */
  note?: string;
}

/**
 * The one place every ledger-affecting write goes through — a real MongoDB
 * multi-document transaction (MongoDB Atlas is always a replica set, so
 * transactions are always available) so concurrent charges/credits against
 * the same customer can never corrupt the running balance. See
 * `docs/AS_BUILT.md`'s "Customer balance billing" section.
 */
export class BalanceService {
  readonly #balances;
  readonly #ledger;

  constructor(
    private readonly client: Pick<MongoClient, "startSession">,
    db: Db,
  ) {
    this.#balances = db.collection<CustomerBalanceDocument>("customerBalances");
    this.#ledger = db.collection<FinancialTransactionDocument>("financialTransactions");
  }

  async getBalance(userId: string): Promise<CustomerBalanceDocument> {
    const existing = await this.#balances.findOne({ _id: userId });
    if (existing) return existing;
    return { _id: userId, balanceUsd: 0, tier: tierForBalance(0), updatedAt: new Date() };
  }

  /**
   * Blocks a new verification once a customer's balance is already at or
   * below zero. Deliberately a hard `<= 0` gate rather than a per-call cost
   * estimate: real cost (minutes talked, whether an SMS was even sendable)
   * isn't known until after the attempt completes. No per-type minimum
   * floor (a $0.30 minimum for `sms_code`/`voice_challenge` was tried and
   * then deliberately removed — it doesn't make sense once an active
   * project is charged the daily plan fee regardless of balance; the free
   * usage quota, not a balance floor, is what protects a brand-new
   * account — see `backend/packages/api/src/usage-quota-service.ts`). Exempts the
   * platform-admin-owned demo project — there is no real customer balance
   * behind the public marketing demo to charge. Only reached once
   * `UsageQuotaService#tryConsumeFreeQuota` reports the request isn't
   * covered by the account's free monthly quota.
   */
  async requireNonNegativeBalance(userId: string): Promise<void> {
    if (userId === PLATFORM_ADMIN_USER_ID) return;
    const balance = await this.getBalance(userId);
    if (balance.balanceUsd <= 0) {
      throw new BillingError("insufficient_balance", 402);
    }
  }

  /**
   * Applies one ledger entry: reads the current balance, resolves the
   * charge/credit amount, inserts the append-only ledger row, and updates
   * the materialized balance cache — all inside one Mongo transaction.
   * Never charges the platform-admin-owned demo project (see
   * `PLATFORM_ADMIN_USER_ID`); returns `undefined` in that case since there
   * is nothing to record.
   */
  async applyLedgerEntry(input: LedgerEntryInput): Promise<FinancialTransactionDocument | undefined> {
    if (input.userId === PLATFORM_ADMIN_USER_ID) return undefined;

    const session = this.client.startSession() as ClientSession;
    try {
      let entry: FinancialTransactionDocument | undefined;
      await session.withTransaction(async () => {
        const current = await this.#balances.findOne({ _id: input.userId }, { session });
        const openingBalanceUsd = current?.balanceUsd ?? 0;
        const tierAtTransaction = tierForBalance(openingBalanceUsd);
        const amountUsd =
          typeof input.amountUsd === "function"
            ? await input.amountUsd(tierAtTransaction)
            : input.amountUsd;
        const closingBalanceUsd = roundCurrency(openingBalanceUsd + amountUsd);
        const now = new Date();

        entry = {
          _id: createSortableId("txn"),
          userId: input.userId,
          projectId: input.projectId,
          interactionId: input.interactionId,
          stripePaymentId: input.stripePaymentId,
          type: input.type,
          country: input.country,
          note: input.note,
          openingBalanceUsd,
          tierAtTransaction,
          amountUsd,
          closingBalanceUsd,
          createdAt: now,
        };

        await this.#ledger.insertOne(entry, { session });
        await this.#balances.updateOne(
          { _id: input.userId },
          {
            $set: {
              balanceUsd: closingBalanceUsd,
              tier: tierForBalance(closingBalanceUsd),
              updatedAt: now,
            },
          },
          { session, upsert: true },
        );
      });
      return entry;
    } finally {
      await session.endSession();
    }
  }

  async listLedger(userId: string, limit = 50): Promise<FinancialTransactionDocument[]> {
    return this.#ledger.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
  }
}

export function toCustomerBalanceResponse(document: CustomerBalanceDocument): CustomerBalance {
  return {
    userId: document._id,
    balanceUsd: document.balanceUsd,
    tier: document.tier,
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toFinancialTransactionResponse(document: FinancialTransactionDocument): FinancialTransaction {
  return {
    id: document._id,
    userId: document.userId,
    projectId: document.projectId,
    interactionId: document.interactionId,
    stripePaymentId: document.stripePaymentId,
    type: document.type,
    country: document.country,
    note: document.note,
    openingBalanceUsd: document.openingBalanceUsd,
    tierAtTransaction: document.tierAtTransaction,
    amountUsd: document.amountUsd,
    closingBalanceUsd: document.closingBalanceUsd,
    createdAt: document.createdAt.toISOString(),
  };
}
