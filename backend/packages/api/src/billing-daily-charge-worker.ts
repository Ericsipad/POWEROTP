import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Db } from "mongodb";

import type { BalanceService } from "./balance-service.js";
import type { FinancialTransactionDocument } from "./billing-persistence.js";
import type { ProjectDocument } from "./persistence.js";
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

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Charges every active project's owning customer the `dailyChargedUsd` plan
 * fee for their current tier — "each card we show" (a project/"website
 * install") gets its own daily row, per `docs/AS_BUILT.md`'s "Customer
 * balance billing" section. Never the demo project (its owning customer is
 * the platform admin, which `BalanceService#applyLedgerEntry` already
 * exempts). Per-project idempotency (not just the repeatable job's stable
 * `jobId`) guards against double-charging if a restart reruns the same
 * calendar day's tick after partially completing it.
 */
export function createBillingDailyChargeWorker(
  connection: ConnectionOptions,
  db: Db,
  balances: BalanceService,
  rates: RateChartService,
) {
  const projects = db.collection<ProjectDocument>("projects");
  const ledger = db.collection<FinancialTransactionDocument>("financialTransactions");

  return new Worker(
    BILLING_DAILY_CHARGE_QUEUE_NAME,
    async () => {
      const activeProjects = await projects.find({ active: true }).toArray();
      const since = startOfTodayUtc();

      for (const project of activeProjects) {
        try {
          const alreadyCharged = await ledger.findOne({
            projectId: project._id,
            type: "daily_charge",
            createdAt: { $gte: since },
          });
          if (alreadyCharged) continue;

          await balances.applyLedgerEntry({
            userId: project.customerId,
            projectId: project._id,
            type: "daily_charge",
            amountUsd: async (tier) => {
              const planCharge = await rates.planChargeFor(tier);
              return planCharge ? -planCharge.dailyChargedUsd : 0;
            },
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              service: "powerotp-api",
              component: "billing-daily-charge",
              msg: "daily charge failed for one project",
              projectId: project._id,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      }
    },
    { connection },
  );
}
