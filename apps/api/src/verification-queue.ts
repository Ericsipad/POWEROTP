import { Queue, Worker, type ConnectionOptions } from "bullmq";

import type { TransportRegistry } from "./transport.js";
import type { VerificationService } from "./verification-service.js";

const JOBS_QUEUE_NAME = "verification-jobs";
const CALLBACKS_QUEUE_NAME = "verification-callbacks";

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

export interface VerificationQueues {
  jobsQueue: Queue<DispatchJobData | TimeoutJobData>;
  callbacksQueue: Queue<CallbackJobData>;
  enqueueDispatch(interactionId: string): Promise<void>;
  enqueueTimeout(interactionId: string, delayMs: number): Promise<void>;
  enqueueCallback(interactionId: string, eventId: string): Promise<void>;
  close(): Promise<void>;
}

export function createVerificationQueues(connection: ConnectionOptions): VerificationQueues {
  const jobsQueue = new Queue<DispatchJobData | TimeoutJobData>(JOBS_QUEUE_NAME, {
    connection,
  });
  const callbacksQueue = new Queue<CallbackJobData>(CALLBACKS_QUEUE_NAME, { connection });

  return {
    jobsQueue,
    callbacksQueue,
    async enqueueDispatch(interactionId) {
      await jobsQueue.add(
        "dispatch",
        { interactionId },
        { jobId: `dispatch:${interactionId}`, attempts: 3, backoff: { type: "exponential", delay: 2_000 } },
      );
    },
    async enqueueTimeout(interactionId, delayMs) {
      await jobsQueue.add(
        "timeout",
        { interactionId },
        { jobId: `timeout:${interactionId}`, delay: Math.max(delayMs, 0) },
      );
    },
    async enqueueCallback(interactionId, eventId) {
      await callbacksQueue.add(
        "callback",
        { interactionId, eventId },
        {
          jobId: `callback:${eventId}`,
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    },
    async close() {
      await Promise.allSettled([jobsQueue.close(), callbacksQueue.close()]);
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
        },
        {
          async advance(state, reasonCode) {
            await service.transition(interactionId, state, reasonCode);
          },
        },
      );
    },
    { connection },
  );
}
