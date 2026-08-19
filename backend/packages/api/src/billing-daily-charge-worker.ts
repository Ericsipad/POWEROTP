import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Db } from "mongodb";

import { AccountingDailyService } from "./accounting-daily-service.js";
import type { BalanceService } from "./balance-service.js";
import type { RateChartService } from "./rate-chart-service.js";

const BILLING_DAILY_CHARGE_QUEUE_NAME = "billing-daily-charges";
const BILLING_DAILY_CHARGE_JOB_ID = "billing-daily-charge-tick";
/** Once/day is a simplification, not aligned to a fixed wall-clock time
 * (e.g. midnight UTC) — the per-project idempotency check below (a
 * `daily_charge` row already exists for this project since the start of
 * today, UTC) is what actually prevents a double charge, not the repeat
 * interval alone. */
const BILLING_DAILY_CHARGE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function createBillingDailyChargeQueue(connection: ConnectionOptions) {
  return new Queue(BILLING_DAILY_CHARGE_QUEUE_NAME, { connection });
}

/** Idempotent to call on every server boot, same convention as
 * `backend/packages/api/src/alert-worker.ts#scheduleAlertChecks`. */
export async function scheduleBillingDailyCharges(queue: Queue) {
  await queue.add(
    "tick",
    {},
    { jobId: BILLING_DAILY_CHARGE_JOB_ID, repeat: { every: BILLING_DAILY_CHARGE_INTERVAL_MS } },
  );
}

/**
 * Runs all daily account settlement in a stable order: entered ad payouts,
 * project signup/signin thresholds, then the existing per-project plan fee.
 * Every monetary operation owns a durable idempotency claim.
 */
export function createBillingDailyChargeWorker(
  connection: ConnectionOptions,
  db: Db,
  balances: BalanceService,
  rates: RateChartService,
) {
  const accounting = new AccountingDailyService(db, balances, rates);

  return new Worker(
    BILLING_DAILY_CHARGE_QUEUE_NAME,
    async () => {
      await accounting.run();
    },
    { connection },
  );
}
