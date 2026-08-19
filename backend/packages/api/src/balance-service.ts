import type {
  BillingTier,
  FinancialTransactionType,
} from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

import type {
  BillingIdempotencyClaimDocument,
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
  amountUsd:
    | number
    | ((
        tier: BillingTier,
        priorEntries: readonly FinancialTransactionDocument[],
      ) => number | Promise<number>);
  projectId?: string;
  interactionId?: string;
  sessionId?: string;
  paymentProcessor?: string;
  paymentProcessorTransactionId?: string;
  sourceTransactionId?: string;
  sourceEntryIndex?: number;
  adPayoutId?: string;
  adSettlementId?: string;
  thresholdRuleId?: string;
  referralCode?: string;
  commissionPercent?: number;
  commissionBaseUsd?: number;
  omitWhenZero?: boolean;
  country?: string;
  /** The admin's stated reason for `admin_adjustment` entries (see
   * `POST /v1/admin/billing/credit`), or the literal `"free_quota"` for a
   * free-quota-covered OTP entry. */
  note?: string;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
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
  readonly #claims;

  constructor(
    private readonly client: Pick<MongoClient, "startSession">,
    db: Db,
  ) {
    this.#balances = db.collection<CustomerBalanceDocument>("customerBalances");
    this.#ledger = db.collection<FinancialTransactionDocument>("financialTransactions");
    this.#claims = db.collection<BillingIdempotencyClaimDocument>("billingIdempotencyClaims");
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
    const [entry] = await this.applyLedgerEntries([input]);
    return entry;
  }

  /**
   * Applies an ordered set of related rows in one Mongo transaction. This is
   * used when a project charge/credit and its referral commission must either
   * both commit or both roll back. Repeated user IDs observe the balance left
   * by the preceding row, so tier changes inside a batch are authoritative.
   */
  async applyLedgerEntries(
    inputs: readonly LedgerEntryInput[],
    idempotencyKey?: string,
    onApplied?: (
      entries: readonly FinancialTransactionDocument[],
      session: ClientSession,
    ) => Promise<void>,
  ): Promise<FinancialTransactionDocument[]> {
    const billableInputs = inputs.filter((input) => input.userId !== PLATFORM_ADMIN_USER_ID);
    if (billableInputs.length === 0) return [];
    const session = this.client.startSession() as ClientSession;
    try {
      const entries: FinancialTransactionDocument[] = [];
      try {
        await session.withTransaction(async () => {
          if (idempotencyKey) {
            await this.#claims.insertOne({ _id: idempotencyKey, createdAt: new Date() }, { session });
          }
          const balances = new Map<string, number>();
          for (const input of billableInputs) {
            let openingBalanceUsd = balances.get(input.userId);
            if (openingBalanceUsd === undefined) {
              const current = await this.#balances.findOne({ _id: input.userId }, { session });
              openingBalanceUsd = current?.balanceUsd ?? 0;
            }
            const tierAtTransaction = tierForBalance(openingBalanceUsd);
            const amountUsd = roundCurrency(
              typeof input.amountUsd === "function"
                ? await input.amountUsd(tierAtTransaction, entries)
                : input.amountUsd,
            );
            if (input.omitWhenZero && amountUsd === 0) continue;
            const closingBalanceUsd = roundCurrency(openingBalanceUsd + amountUsd);
            const now = new Date();
            const sourceTransactionId =
              input.sourceTransactionId ??
              (input.sourceEntryIndex === undefined
                ? undefined
                : entries[input.sourceEntryIndex]?._id);

            const entry: FinancialTransactionDocument = {
              _id: createSortableId("txn"),
              userId: input.userId,
              projectId: input.projectId,
              interactionId: input.interactionId,
              sessionId: input.sessionId,
              paymentProcessor: input.paymentProcessor,
              paymentProcessorTransactionId: input.paymentProcessorTransactionId,
              sourceTransactionId,
              adPayoutId: input.adPayoutId,
              adSettlementId: input.adSettlementId,
              thresholdRuleId: input.thresholdRuleId,
              referralCode: input.referralCode,
              commissionPercent: input.commissionPercent,
              commissionBaseUsd:
                input.commissionBaseUsd ??
                (input.sourceEntryIndex === undefined
                  ? undefined
                  : Math.abs(entries[input.sourceEntryIndex]?.amountUsd ?? 0)),
              idempotencyKey,
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
            balances.set(input.userId, closingBalanceUsd);
            entries.push(entry);
          }
          if (onApplied) await onApplied(entries, session);
        });
      } catch (error) {
        if (idempotencyKey && isDuplicateKey(error)) return [];
        throw error;
      }
      return entries;
    } finally {
      await session.endSession();
    }
  }

  async listLedger(userId: string, limit = 50): Promise<FinancialTransactionDocument[]> {
    return this.#ledger.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async listProjectLedger(
    userId: string,
    projectId: string,
    limit = 50,
  ): Promise<FinancialTransactionDocument[]> {
    return this.#ledger.find({ userId, projectId }).sort({ createdAt: -1 }).limit(limit).toArray();
  }
}
