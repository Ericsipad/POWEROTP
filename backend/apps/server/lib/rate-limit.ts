import { ApiError } from "@powerotp/api/errors.js";
import type { Redis } from "ioredis";

/**
 * A minimal fixed-window limiter backed by the same Valkey instance used
 * for the durable queues, replacing `@fastify/rate-limit`. Each route
 * picks its own key/limit, matching the per-endpoint limits the Fastify
 * routes used to declare inline.
 */
export async function enforceRateLimit(
  redis: Redis,
  key: string,
  max: number,
  windowSeconds: number,
) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  if (count > max) throw new ApiError("rate_limited", 429);
}
