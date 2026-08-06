import { z } from "zod";

import { VerificationTypeSchema } from "./verification.js";

/**
 * Telephony node identity: a per-node hashed bearer secret issued once at
 * enrollment, analogous to a project API key. True mutual TLS is not
 * straightforward to terminate on DigitalOcean App Platform's shared
 * ingress, so a droplet authenticates back to the control plane the same
 * way a customer server authenticates to the verification API — a secret
 * sent as `Authorization: Bearer <secret>` over TLS, hashed at rest and
 * immediately revocable.
 */
export const NodeStatusSchema = z.enum(["active", "revoked"]);

export const NodeNameSchema = z.string().trim().min(2).max(80);
export const NodeRegionSchema = z.string().trim().min(2).max(40);

export const CreateNodeSchema = z.object({
  name: NodeNameSchema,
  region: NodeRegionSchema,
});

export const NodeSchema = z.object({
  id: z.string().min(16),
  name: NodeNameSchema,
  region: NodeRegionSchema,
  status: NodeStatusSchema,
  secretPrefix: z.string().min(1),
  secretLastFour: z.string().length(4),
  enrolledAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
});

/**
 * Returned exactly once, at enrollment time, the same way a project API
 * key is returned once at project creation. The operator copies `secret`
 * onto the droplet's protected agent env file; it is never retrievable
 * again afterward.
 */
export const NodeEnrolledSchema = z.object({
  node: NodeSchema,
  secret: z.string().min(32),
});

export const OutboundTrunkConfigSchema = z.object({
  url: z.string().min(1),
  user: z.string().min(1),
  pass: z.string().min(1),
});

/**
 * What a node pulls from the control plane once authenticated: the
 * outbound VoIP.ms trunk credentials for whichever verification methods
 * currently have credentials configured in App Platform. A method with no
 * configured trunk is simply absent, so a node can come online before
 * every trunk is provisioned.
 */
export const NodeConfigSchema = z.object({
  nodeId: z.string().min(16),
  trunks: z.record(VerificationTypeSchema, OutboundTrunkConfigSchema.optional()),
});

export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type CreateNode = z.infer<typeof CreateNodeSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type NodeEnrolled = z.infer<typeof NodeEnrolledSchema>;
export type OutboundTrunkConfig = z.infer<typeof OutboundTrunkConfigSchema>;
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
