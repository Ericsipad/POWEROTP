import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Db } from "mongodb";

import { dispatchAlerts } from "./alert-dispatcher.js";
import {
  evaluateFailureRate,
  evaluateQueueBacklog,
  evaluateStaleNodes,
} from "./alerting-service.js";
import type { ProductionConfig } from "./config.js";
import type { EmailService } from "./email.js";
import type { NodeService } from "./node-service.js";
import { countRecentOutcomes } from "./verification-reporting.js";
import { FAILURE_RATE_WINDOW_MS } from "./alerting-service.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";
import type { VerificationQueues } from "./verification-queue.js";

const ALERTS_QUEUE_NAME = "platform-alerts";
const ALERT_CHECK_JOB_ID = "platform-alert-check";
/** Runs a fresh check every 5 minutes — frequent enough to catch a real
 * incident quickly, infrequent enough not to spam Brevo/Mongo. */
const ALERT_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

export function createAlertQueue(connection: ConnectionOptions) {
  return new Queue(ALERTS_QUEUE_NAME, { connection });
}

/** Registers the recurring check as a BullMQ repeatable job — idempotent to
 * call on every server boot (a stable `jobId` means it's just a no-op on
 * every boot after the first). */
export async function scheduleAlertChecks(queue: Queue) {
  await queue.add(
    "check",
    {},
    { jobId: ALERT_CHECK_JOB_ID, repeat: { every: ALERT_CHECK_INTERVAL_MS } },
  );
}

/**
 * Checks queue backlog, recent failure rate, and node staleness (see
 * `backend/packages/api/src/alerting-service.ts` for the pure threshold logic) every
 * `ALERT_CHECK_INTERVAL_MS` and emails `ADMIN_EMAIL` on anything newly
 * triggered — see `docs/AS_BUILT.md`'s "Admin operator health dashboard"
 * section.
 */
export function createAlertWorker(
  connection: ConnectionOptions,
  db: Db,
  config: ProductionConfig,
  queues: VerificationQueues,
  nodes: NodeService,
  email: EmailService,
) {
  const requests = db.collection<VerificationRequestDocument>("verificationRequests");

  return new Worker(
    ALERTS_QUEUE_NAME,
    async () => {
      const [queueCounts, outcomes, nodeList] = await Promise.all([
        queues.getQueueCounts(),
        countRecentOutcomes(requests, FAILURE_RATE_WINDOW_MS),
        nodes.list(),
      ]);

      const conditions = [
        ...evaluateQueueBacklog(queueCounts),
        ...evaluateFailureRate(outcomes.total, outcomes.failed),
        ...evaluateStaleNodes(nodeList, Date.now()),
      ];

      await dispatchAlerts(db, email, config, conditions);
    },
    { connection },
  );
}
