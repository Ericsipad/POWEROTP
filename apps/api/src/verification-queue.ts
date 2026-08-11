import { Queue, Worker, type ConnectionOptions } from "bullmq";

import type { TransportRegistry } from "./transport.js";
import type { VerificationService } from "./verification-service.js";

const JOBS_QUEUE_NAME = "verification-jobs";
const CALLBACKS_QUEUE_NAME = "verification-callbacks";
const PROVIDER_RECONCILE_QUEUE_NAME = "verification-provider-reconcile";

/** VoIP.ms's own CDR/SMS records are not always available the instant a
 * call/SMS finishes — this delay plus the retry backoff below (see
 * `apps/api/src/provider-reconcile-worker.ts`) gives them a few minutes to
 * appear before giving up and marking the interaction `not_found`. */
const PROVIDER_RECONCILE_INITIAL_DELAY_MS = 3 * 60 * 1_000;

/**
 * BullMQ manages its own dedicated Redis connections per Queue/Worker (and
 * requires `maxRetriesPerRequest: null`), so it is configured from plain
 * connection options rather than sharing the application's ioredis client
 * instance, which also avoids cross-package type incompatibilities between
 * the app's ioredis version and BullMQ's bundled one.
 */
export function toQueueConnectionOptions(valkeyUrl: string): ConnectionOptions {
  const url = new URL(valkeyUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6_379,
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export interface CallbackJobData {
  interactionId: string;
  eventId: string;
}

interface DispatchJobData {
  interactionId: string;
}

interface TimeoutJobData {
  interactionId: string;
}

export interface ProviderReconcileJobData {
  interactionId: string;
}

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface VerificationQueues {
  jobsQueue: Queue<DispatchJobData | TimeoutJobData>;
  callbacksQueue: Queue<CallbackJobData>;
  providerReconcileQueue: Queue<ProviderReconcileJobData>;
  enqueueDispatch(interactionId: string): Promise<void>;
  enqueueTimeout(interactionId: string, delayMs: number): Promise<void>;
  enqueueCallback(interactionId: string, eventId: string): Promise<void>;
  enqueueProviderReconcile(interactionId: string): Promise<void>;
  /**
   * Current job counts for every queue this app runs — for the admin
   * "operator health" view (see `docs/AS_BUILT.md`'s "Admin operator health
   * dashboard" section), so a stuck/backed-up queue is visible without a
   * direct Valkey connection.
   */
  getQueueCounts(): Promise<QueueCounts[]>;
  close(): Promise<void>;
}

export function createVerificationQueues(connection: ConnectionOptions): VerificationQueues {
  const jobsQueue = new Queue<DispatchJobData | TimeoutJobData>(JOBS_QUEUE_NAME, {
    connection,
  });
  const callbacksQueue = new Queue<CallbackJobData>(CALLBACKS_QUEUE_NAME, { connection });
  const providerReconcileQueue = new Queue<ProviderReconcileJobData>(PROVIDER_RECONCILE_QUEUE_NAME, {
    connection,
  });

  return {
    jobsQueue,
    callbacksQueue,
    providerReconcileQueue,
    async enqueueDispatch(interactionId) {
      // BullMQ job IDs may not contain ":" (it uses colons as a Redis key
      // delimiter internally), so job names and IDs are hyphen-separated.
      await jobsQueue.add(
        "dispatch",
        { interactionId },
        { jobId: `dispatch-${interactionId}`, attempts: 3, backoff: { type: "exponential", delay: 2_000 } },
      );
    },
    async enqueueTimeout(interactionId, delayMs) {
      await jobsQueue.add(
        "timeout",
        { interactionId },
        { jobId: `timeout-${interactionId}`, delay: Math.max(delayMs, 0) },
      );
    },
    async enqueueCallback(interactionId, eventId) {
      await callbacksQueue.add(
        "callback",
        { interactionId, eventId },
        {
          jobId: `callback-${eventId}`,
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    },
    async enqueueProviderReconcile(interactionId) {
      // Delayed, not immediate — see PROVIDER_RECONCILE_INITIAL_DELAY_MS.
      // A stable jobId per interaction means calling this more than once
      // for the same interaction (it never should, but `transition()`'s
      // guard is defensive) just no-ops instead of scheduling a duplicate.
      await providerReconcileQueue.add(
        "reconcile",
        { interactionId },
        {
          jobId: `reconcile-${interactionId}`,
          delay: PROVIDER_RECONCILE_INITIAL_DELAY_MS,
          attempts: 5,
          backoff: { type: "fixed", delay: 2 * 60 * 1_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    },
    async getQueueCounts() {
      const named: Array<[string, Queue]> = [
        [JOBS_QUEUE_NAME, jobsQueue],
        [CALLBACKS_QUEUE_NAME, callbacksQueue],
        [PROVIDER_RECONCILE_QUEUE_NAME, providerReconcileQueue],
      ];
      return Promise.all(
        named.map(async ([name, queue]) => {
          const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            completed: counts.completed ?? 0,
          };
        }),
      );
    },
    async close() {
      await Promise.allSettled([
        jobsQueue.close(),
        callbacksQueue.close(),
        providerReconcileQueue.close(),
      ]);
    },
  };
}

export function createDispatchWorker(
  connection: ConnectionOptions,
  service: VerificationService,
  transports: TransportRegistry,
) {
  return new Worker<DispatchJobData | TimeoutJobData>(
    JOBS_QUEUE_NAME,
    async (job) => {
      const { interactionId } = job.data;
      if (job.name === "timeout") {
        await service.transition(interactionId, "expired", "interaction_expired");
        return;
      }

      const verification = await service.get(interactionId);
      if (!verification) return;

      const transport = transports[verification.type];
      await transport.dispatch(
        {
          interactionId,
          type: verification.type,
          targetNumber: verification.targetNumber,
          code:
            verification.type === "sms_code" || verification.type === "email_code"
              ? service.codeForDelivery(verification)
              : undefined,
          branding: verification.type === "email_code" ? verification.emailBranding : undefined,
        },
        {
          async advance(state, reasonCode, meta) {
            if (meta?.smsDid || meta?.emailSent) {
              await service.recordProviderAttemptMeta(interactionId, {
                smsDid: meta.smsDid,
                emailSent: meta.emailSent,
              });
            }
            return service.transition(interactionId, state, reasonCode);
          },
        },
      );
    },
    { connection },
  );
}
