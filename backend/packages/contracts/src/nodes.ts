import { z } from "zod";

import { TargetNumberSchema, VerificationTypeSchema } from "./verification.js";

/**
 * Telephony node identity is one shared secret (`NODE_SECRET`), the same
 * pattern this app already uses for platform admin login
 * (`ADMIN_PASSWORD`) — not a per-node secret and not mutual TLS. A droplet
 * needs zero individual configuration beyond the fixed control-plane URL
 * and that one secret baked in at deployment time; it starts appearing
 * here automatically the next time it authenticates. There is nothing to
 * generate, copy, or ever edit on the node itself afterward. Revoking
 * access is rotating `NODE_SECRET` in App Platform and redeploying every
 * node with the new value. See `backend/packages/api/src/node-service.ts`.
 */
/**
 * Real SIP registration state for one trunk id, as last reported by a node
 * (see `apps/telephony-agent/src/pjsip-status.ts`), plus that trunk's
 * separate call-outcome-based health/rotation state (see
 * `apps/telephony-agent/src/trunk-pool.ts#snapshot`) — two independent
 * signals surfaced together for the admin "operator health" view (see
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section). Neither
 * ever fed the other; a trunk can be `Registered` but still `healthy: false`
 * if recent call attempts over it were provider-rejected, or vice versa.
 */
export const TrunkStatusSchema = z.object({
  id: z.string().min(1),
  registrationState: z.enum(["Registered", "Rejected", "Unregistered", "Unknown"]),
  healthy: z.boolean(),
  consecutiveFailures: z.number().int().nonnegative(),
  /** Epoch ms until this trunk is skipped by rotation, if currently down. */
  downUntil: z.number().optional(),
});

export const TrunkStatusReportSchema = z.object({
  trunks: z.array(TrunkStatusSchema),
});

/**
 * A node polls `/v1/nodes/config` every `POLL_INTERVAL_MS` (60s default, see
 * `apps/telephony-agent/src/config.ts`) — 3x that is a reasonable buffer
 * before treating a node as unexpectedly quiet rather than just between
 * polls. Shared between `/admin`'s staleness badge
 * (`frontend/app/admin/page.tsx`) and the platform alerting job
 * (`backend/packages/api/src/alerting-service.ts`) so both sides agree on one
 * definition of "stale".
 */
export const NODE_STALE_THRESHOLD_MS = 3 * 60_000;

export const NodeSchema = z.object({
  id: z.string().min(16),
  ip: z.string().min(1),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  trunkStatus: z.array(TrunkStatusSchema).optional(),
  trunkStatusReportedAt: z.string().datetime().optional(),
});

export const OutboundTrunkConfigSchema = z.object({
  url: z.string().min(1),
  user: z.string().min(1),
  pass: z.string().min(1),
});

/**
 * What a node pulls from the control plane once its IP is allowlisted: a
 * flat pool of outbound VoIP.ms trunk credentials, each tagged with a
 * stable id. Trunk identity is no longer tied to a verification type —
 * any configured trunk can serve any of the three voice verification
 * methods (`call_reachability`, `voice_code`, `voice_challenge`); the
 * node itself decides which trunk to use per call via rotation and
 * failover (see `apps/telephony-agent/src/trunk-pool.ts`). Every
 * allowlisted node receives the same full configuration — there is no
 * per-node scoping, so any node can be added or replaced at any time
 * without a separate assignment step.
 */
export const NodeConfigSchema = z.object({
  trunks: z.array(OutboundTrunkConfigSchema.extend({ id: z.string().min(1) })),
});

/**
 * One unit of call-control work a node can claim and execute: an
 * interaction that is waiting for a node to actually place the call over
 * one of its already-registered trunks. Never carries credentials or a
 * specific trunk — the node picks a currently-healthy trunk itself, by
 * id, from its own pool (see `apps/telephony-agent/src/trunk-pool.ts`
 * and `apps/telephony-agent/src/pjsip-config.ts`'s `trunk-<id>` naming).
 */
export const NodeJobSchema = z.object({
  interactionId: z.string().min(16),
  type: VerificationTypeSchema,
  targetNumber: TargetNumberSchema,
  /**
   * Only present for `voice_code` jobs: the five-digit code to speak over
   * the call. Never persisted in plaintext (see
   * `backend/packages/api/src/verification-service.ts`) — decrypted only for this one
   * response, to this one authenticated node, for this one claim.
   */
  code: z.string().regex(/^\d{5}$/).optional(),
  /**
   * Only present for `voice_challenge` jobs: the local basename (no path,
   * no Spaces key) of the already-synced recording to play via ARI's
   * `sound:` media type. See `apps/telephony-agent/src/media-sync.ts` for
   * how a node keeps its local copy checksummed and in sync.
   */
  soundBasename: z.string().min(1).optional(),
});

/**
 * States a node is allowed to report back for a job it claimed. Never
 * includes `queued`/`dispatching`/`calling`, which only the control plane
 * itself assigns (`calling` is set atomically by the claim itself).
 */
export const reportableNodeJobStates = [
  "ringing",
  "answered",
  "playing",
  "awaiting_response",
  "succeeded",
  "failed",
  "canceled",
] as const;

export const NodeJobEventSchema = z.object({
  state: z.enum(reportableNodeJobStates),
  reasonCode: z.string().min(1).max(100).optional(),
  /**
   * Which trunk id (`trunk-1`, `trunk-2`, ...) actually produced this
   * outcome — only meaningful on the final `succeeded`/`failed`/
   * `awaiting_response` report of a job, since an earlier progress report
   * within the same job can belong to a trunk attempt that failed over to
   * another one (see `apps/telephony-agent/src/job-poller.ts#runJobWithFailover`).
   * Recorded on the interaction (`VerificationRequestDocument#callTrunkId`)
   * so a later billing-reconciliation pass knows which VoIP.ms subaccount
   * to query for this call's real cost/duration — see
   * `backend/packages/api/src/provider-reconcile-service.ts`.
   */
  trunkId: z.string().min(1).optional(),
});

/**
 * BullMQ job counts for one queue (`Queue#getJobCounts`), surfaced read-only
 * on the admin "operator health" view (see `backend/packages/api/src/verification-queue.ts#getQueueCounts`)
 * so a stuck/backed-up queue is visible without a direct Valkey connection.
 */
export const QueueCountsSchema = z.object({
  name: z.string().min(1),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});

export const QueueCountsResponseSchema = z.object({
  queues: z.array(QueueCountsSchema),
});

export type Node = z.infer<typeof NodeSchema>;
export type OutboundTrunkConfig = z.infer<typeof OutboundTrunkConfigSchema>;
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
export type NodeJob = z.infer<typeof NodeJobSchema>;
export type NodeJobEvent = z.infer<typeof NodeJobEventSchema>;
export type TrunkStatus = z.infer<typeof TrunkStatusSchema>;
export type TrunkStatusReport = z.infer<typeof TrunkStatusReportSchema>;
export type QueueCounts = z.infer<typeof QueueCountsSchema>;
export type QueueCountsResponse = z.infer<typeof QueueCountsResponseSchema>;
