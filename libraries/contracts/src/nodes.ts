import { z } from "zod";

import { VerificationTypeSchema } from "./verification.js";

/**
 * Telephony node identity is a source-IP allowlist (`NODE_ALLOWED_IPS`),
 * the same pattern this app already uses for platform admin login
 * (`ADMIN_ALLOWED_IPS`) — not a per-node secret. A droplet needs zero
 * credentials or manual configuration beyond the fixed control-plane URL:
 * add its public IP to `NODE_ALLOWED_IPS` in App Platform and it starts
 * appearing here automatically the next time it polls for config. There is
 * nothing to generate, copy, or ever edit on the node itself. Revoking a
 * node is removing its IP from that same env var and redeploying, exactly
 * like changing the admin allowlist.
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
  trunks: z.record(VerificationTypeSchema, OutboundTrunkConfigSchema.optional()),
});

export type Node = z.infer<typeof NodeSchema>;
export type OutboundTrunkConfig = z.infer<typeof OutboundTrunkConfigSchema>;
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
