import { NODE_STALE_THRESHOLD_MS } from "@powerotp/contracts";

import type { QueueCounts } from "./verification-queue.js";

/** Waiting + delayed jobs on one queue above which it's considered backed up. */
export const QUEUE_BACKLOG_THRESHOLD = 50;
/** Failed jobs on one queue above which something is likely stuck. */
export const QUEUE_FAILED_THRESHOLD = 20;

/** Recent-interaction window a high-failure-rate alert looks back over. */
export const FAILURE_RATE_WINDOW_MS = 60 * 60 * 1_000;
/** Don't alert on a tiny sample (e.g. one failed call out of one attempt). */
export const FAILURE_RATE_MIN_SAMPLES = 5;
/** Failure/expiry rate within the window above which something is wrong. */
export const FAILURE_RATE_THRESHOLD = 0.5;

export interface AlertCondition {
  /** Stable per-condition key used for cooldown dedup — see `alert-dispatcher.ts`. */
  key: string;
  message: string;
}

export interface StaleNodeCheckInput {
  id: string;
  ip: string;
  lastSeenAt: string;
}

/**
 * Pure decision functions only — every Mongo/BullMQ/Node lookup happens in
 * the caller (`apps/api/src/alert-worker.ts`), so these are trivially
 * unit-testable without a live Redis/Mongo connection.
 */

export function evaluateQueueBacklog(queues: QueueCounts[]): AlertCondition[] {
  const alerts: AlertCondition[] = [];
  for (const queue of queues) {
    const backlog = queue.waiting + queue.delayed;
    if (backlog > QUEUE_BACKLOG_THRESHOLD) {
      alerts.push({
        key: `queue_backlog:${queue.name}`,
        message: `Queue "${queue.name}" has ${backlog} waiting/delayed jobs (threshold ${QUEUE_BACKLOG_THRESHOLD}).`,
      });
    }
    if (queue.failed > QUEUE_FAILED_THRESHOLD) {
      alerts.push({
        key: `queue_failed:${queue.name}`,
        message: `Queue "${queue.name}" has ${queue.failed} failed jobs (threshold ${QUEUE_FAILED_THRESHOLD}).`,
      });
    }
  }
  return alerts;
}

export function evaluateFailureRate(totalInWindow: number, failedInWindow: number): AlertCondition[] {
  if (totalInWindow < FAILURE_RATE_MIN_SAMPLES) return [];
  const rate = failedInWindow / totalInWindow;
  if (rate <= FAILURE_RATE_THRESHOLD) return [];
  return [
    {
      key: "high_failure_rate",
      message: `${failedInWindow}/${totalInWindow} verifications failed or expired in the last hour (${Math.round(rate * 100)}%, threshold ${Math.round(FAILURE_RATE_THRESHOLD * 100)}%).`,
    },
  ];
}

export function evaluateStaleNodes(nodes: StaleNodeCheckInput[], nowMs: number): AlertCondition[] {
  return nodes
    .filter((node) => nowMs - new Date(node.lastSeenAt).getTime() > NODE_STALE_THRESHOLD_MS)
    .map((node) => ({
      key: `node_stale:${node.id}`,
      message: `Telephony node ${node.ip} has not polled since ${node.lastSeenAt} (stale threshold ${NODE_STALE_THRESHOLD_MS / 60_000} minutes).`,
    }));
}
