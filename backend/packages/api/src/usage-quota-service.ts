import type { VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

import { PLATFORM_ADMIN_USER_ID, type CustomerAccountDocument } from "./persistence.js";

/**
 * A new account's free monthly allowance per verification type, for its
 * first 180 days only — see `docs/AS_BUILT.md`'s "Customer signup flow"
 * section. `voice_challenge` deliberately has no free allowance (always
 * goes straight to normal balance-gated charging, per explicit product
 * decision). This is a plain usage counter, not a dollar credit — consuming
 * it lets `VerificationService#create` skip
 * `BalanceService#requireNonNegativeBalance` entirely, but the interaction
 * still gets a real $0 ledger row at completion
 * (`backend/packages/api/src/billing-charge-service.ts`, `note: "free_quota"`) so
 * free-quota usage stays fully visible in the same ledger/reports every
 * real charge appears in. Once the 180-day eligibility window has passed,
 * every request of every type is charged normally, with no minimum-balance
 * floor beyond the plain `balance > 0` gate (a per-type $0.30 minimum was
 * tried and then deliberately removed — it doesn't make sense once an
 * active project is charged daily regardless of balance; see
 * `backend/packages/api/src/balance-service.ts#requireNonNegativeBalance`).
 */
const FREE_QUOTA_LIMITS: Partial<Record<VerificationType, number>> = {
  call_reachability: 10,
  voice_code: 10,
  sms_code: 5,
  // The user's own proposed number when `email_code` was scoped, carried
  // over unchanged into this session's actual build — see
  // `docs/AS_BUILT.md`'s "Customer signup flow" section.
  email_code: 1_000,
};

const QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
/** A fixed day count, not "6 calendar months" (which varies 28-31 days per
 * month) — the user's own exact framing: "at 180 days the counter stops". */
const QUOTA_ELIGIBILITY_MS = 180 * 24 * 60 * 60 * 1_000;

export interface UsageQuotaDocument {
  _id: string;
  windowStartAt: Date;
  counts: Partial<Record<VerificationType, number>>;
  eligibleUntil: Date;
}

/**
 * Tracks each customer's rolling-30-day free usage counter per type, for
 * their first 180 days since account creation — a simple counter, never a
 * dollar amount. Not a Mongo transaction: a small race window under
 * concurrent requests could over-consume a quota slot by one, which is
 * self-correcting (see `tryConsumeFreeQuota`) and low-stakes since nothing
 * here is money.
 *
 * Data-minimization / SOC 2-oriented design: this service only ever reads
 * `customerAccounts` (id + signup timestamp, no PII) to seed a new quota
 * document's eligibility window — never `UserDocument` (email/password
 * hash), which stays a concern of `AuthService` alone. Everywhere else in
 * this service, a customer is just an opaque `userId`.
 */
export class UsageQuotaService {
  readonly #quotas;
  readonly #customerAccounts;

  constructor(db: Db) {
    this.#quotas = db.collection<UsageQuotaDocument>("usageQuotas");
    this.#customerAccounts = db.collection<CustomerAccountDocument>("customerAccounts");
  }

  /**
   * Returns `true` and consumes one unit of free quota if this request is
   * covered by the account's remaining free allowance; `false` if it is
   * not (no free type configured, quota already used up for the current
   * rolling window, or the account's 180-day eligibility window has
   * passed) — the caller must then fall through to
   * `BalanceService#requireNonNegativeBalance`.
   */
  async tryConsumeFreeQuota(userId: string, type: VerificationType): Promise<boolean> {
    if (userId === PLATFORM_ADMIN_USER_ID) return true;
    const limit = FREE_QUOTA_LIMITS[type];
    if (!limit) return false;

    const now = new Date();
    let quota = await this.#quotas.findOne({ _id: userId });
    if (!quota) {
      const account = await this.#customerAccounts.findOne({ _id: userId }, { projection: { createdAt: 1 } });
      const signupAt = account?.createdAt ?? now;
      quota = {
        _id: userId,
        windowStartAt: now,
        counts: {},
        eligibleUntil: new Date(signupAt.getTime() + QUOTA_ELIGIBILITY_MS),
      };
      await this.#quotas.updateOne({ _id: userId }, { $setOnInsert: quota }, { upsert: true });
      quota = (await this.#quotas.findOne({ _id: userId })) ?? quota;
    }

    if (now > quota.eligibleUntil) return false;

    if (now.getTime() - quota.windowStartAt.getTime() >= QUOTA_WINDOW_MS) {
      await this.#quotas.updateOne({ _id: userId }, { $set: { windowStartAt: now, counts: {} } });
      quota = { ...quota, windowStartAt: now, counts: {} };
    }

    if ((quota.counts[type] ?? 0) >= limit) return false;

    const updated = await this.#quotas.findOneAndUpdate(
      { _id: userId, windowStartAt: quota.windowStartAt },
      { $inc: { [`counts.${type}`]: 1 } },
      { returnDocument: "after" },
    );
    const usedAfterIncrement = updated?.counts[type] ?? 0;
    if (usedAfterIncrement > limit) {
      // Lost a race against a concurrent request for the same type — undo
      // the over-consumption and fall through to normal balance charging.
      await this.#quotas.updateOne(
        { _id: userId, windowStartAt: quota.windowStartAt },
        { $inc: { [`counts.${type}`]: -1 } },
      );
      return false;
    }
    return true;
  }
}
