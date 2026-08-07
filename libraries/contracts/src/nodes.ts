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
 * node with the new value. See `apps/api/src/node-service.ts`.
 */
export const NodeSchema = z.object({
  id: z.string().min(16),
  ip: z.string().min(1),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});

export const OutboundTrunkConfigSchema = z.object({
  url: z.string().min(1),
  user: z.string().min(1),
  pass: z.string().min(1),
});

/**
 * What a node pulls from the control plane once its IP is allowlisted:
 * the outbound VoIP.ms trunk credentials for whichever verification
 * methods currently have credentials configured in App Platform. Every
 * allowlisted node receives the same full configuration — there is no
 * per-node scoping, so any node can be added or replaced at any time
 * without a separate assignment step.
 */
export const NodeConfigSchema = z.object({
  trunks: z.object({
    call_reachability: OutboundTrunkConfigSchema.optional(),
    voice_code: OutboundTrunkConfigSchema.optional(),
    voice_challenge: OutboundTrunkConfigSchema.optional(),
  }),
});

/**
 * One unit of call-control work a node can claim and execute: an
 * interaction that is waiting for a node to actually place the call over
 * its already-registered trunk. Never carries credentials — a node
 * resolves its own dial string locally from the type (see
 * `apps/telephony-agent/src/pjsip-config.ts`'s `trunk-<type>` naming).
 */
export const NodeJobSchema = z.object({
  interactionId: z.string().min(16),
  type: VerificationTypeSchema,
  targetNumber: TargetNumberSchema,
  /**
   * Only present for `voice_code` jobs: the five-digit code to speak over
   * the call. Never persisted in plaintext (see
   * `apps/api/src/verification-service.ts`) — decrypted only for this one
   * response, to this one authenticated node, for this one claim.
   */
  code: z.string().regex(/^\d{5}$/).optional(),
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
});

export type Node = z.infer<typeof NodeSchema>;
export type OutboundTrunkConfig = z.infer<typeof OutboundTrunkConfigSchema>;
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
export type NodeJob = z.infer<typeof NodeJobSchema>;
export type NodeJobEvent = z.infer<typeof NodeJobEventSchema>;
