import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAILURE_RATE_MIN_SAMPLES,
  FAILURE_RATE_THRESHOLD,
  QUEUE_BACKLOG_THRESHOLD,
  QUEUE_FAILED_THRESHOLD,
  evaluateFailureRate,
  evaluateQueueBacklog,
  evaluateStaleNodes,
} from "./alerting-service.js";
import type { QueueCounts } from "./verification-queue.js";

function queue(overrides: Partial<QueueCounts>): QueueCounts {
  return { name: "verification-jobs", waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, ...overrides };
}

describe("evaluateQueueBacklog", () => {
  it("returns nothing when every queue is under both thresholds", () => {
    const alerts = evaluateQueueBacklog([queue({ waiting: 1, failed: 1 })]);
    assert.deepEqual(alerts, []);
  });

  it("alerts on waiting+delayed above the backlog threshold", () => {
    const alerts = evaluateQueueBacklog([
      queue({ name: "verification-jobs", waiting: QUEUE_BACKLOG_THRESHOLD + 1 }),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.key, "queue_backlog:verification-jobs");
  });

  it("alerts on failed count above the failed threshold, independently", () => {
    const alerts = evaluateQueueBacklog([
      queue({ name: "verification-callbacks", failed: QUEUE_FAILED_THRESHOLD + 1 }),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.key, "queue_failed:verification-callbacks");
  });

  it("can alert on both conditions for the same queue at once", () => {
    const alerts = evaluateQueueBacklog([
      queue({
        name: "verification-jobs",
        waiting: QUEUE_BACKLOG_THRESHOLD + 1,
        failed: QUEUE_FAILED_THRESHOLD + 1,
      }),
    ]);
    assert.equal(alerts.length, 2);
  });
});

describe("evaluateFailureRate", () => {
  it("never alerts below the minimum sample size, even at 100% failure", () => {
    const alerts = evaluateFailureRate(FAILURE_RATE_MIN_SAMPLES - 1, FAILURE_RATE_MIN_SAMPLES - 1);
    assert.deepEqual(alerts, []);
  });

  it("does not alert at or below the failure-rate threshold", () => {
    const total = 10;
    const failed = Math.floor(total * FAILURE_RATE_THRESHOLD);
    const alerts = evaluateFailureRate(total, failed);
    assert.deepEqual(alerts, []);
  });

  it("alerts once enough samples exist and the failure rate exceeds the threshold", () => {
    const alerts = evaluateFailureRate(10, 8);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.key, "high_failure_rate");
  });
});

describe("evaluateStaleNodes", () => {
  it("does not flag a node seen recently", () => {
    const now = Date.now();
    const alerts = evaluateStaleNodes(
      [{ id: "node_1", ip: "1.2.3.4", lastSeenAt: new Date(now - 1_000).toISOString() }],
      now,
    );
    assert.deepEqual(alerts, []);
  });

  it("flags a node that has gone quiet past the shared stale threshold", () => {
    const now = Date.now();
    const alerts = evaluateStaleNodes(
      [{ id: "node_1", ip: "1.2.3.4", lastSeenAt: new Date(now - 10 * 60_000).toISOString() }],
      now,
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.key, "node_stale:node_1");
  });
});
