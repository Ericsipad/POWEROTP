/**
 * Backend-only. This file defines the `policyReleases` MongoDB persistence
 * document schema and must never be reachable from
 * `@powerotp/contracts/browser` — see that file's doc comment.
 */
import { z } from "zod";

import { SignedBotBlockerPolicyReleaseSchema } from "./botblocker-policy.js";
import {
  DecisionTimeoutMsSchema,
  SiteIdSchema,
} from "./botblocker.js";

const OpaqueIdSchema = z.string().min(16).max(128);

/**
 * Durable, immutable representation of one signed policy publication.
 * Query fields are duplicated outside the signed envelope so MongoDB can
 * select releases efficiently; the refinements prevent those fields from
 * disagreeing with the signed authority.
 */
export const PolicyReleaseRecordSchema = z
  .object({
    policyReleaseId: OpaqueIdSchema,
    customerId: OpaqueIdSchema,
    projectId: OpaqueIdSchema,
    siteId: SiteIdSchema,
    policyVersion: z.number().int().positive(),
    protocolVersion: z.number().int().positive(),
    activatesAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    issuedAt: z.string().datetime(),
    release: SignedBotBlockerPolicyReleaseSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    const policy = record.release.policy;
    const comparisons: Array<[boolean, string, string]> = [
      [policy.siteId === record.siteId, "siteId must match the signed policy", "siteId"],
      [
        record.release.audience === record.siteId,
        "release audience must match siteId",
        "release",
      ],
      [
        policy.policyVersion === record.policyVersion,
        "policyVersion must match the signed policy",
        "policyVersion",
      ],
      [
        policy.protocolVersion === record.protocolVersion,
        "protocolVersion must match the signed policy",
        "protocolVersion",
      ],
      [
        policy.activatesAt === Date.parse(record.activatesAt),
        "activatesAt must match the signed policy",
        "activatesAt",
      ],
      [
        policy.expiresAt === Date.parse(record.expiresAt),
        "expiresAt must match the signed policy",
        "expiresAt",
      ],
      [
        record.release.issuedAt === Date.parse(record.issuedAt),
        "issuedAt must match the signed release",
        "issuedAt",
      ],
    ];
    for (const [valid, message, path] of comparisons) {
      if (!valid) context.addIssue({ code: "custom", message, path: [path] });
    }
  });

/** Public policy response metadata that is intentionally outside the signed
 * release. The timeout is a UX bound, never a security decision boundary. */
export const BotBlockerPolicyResponseSchema = z
  .object({
    release: SignedBotBlockerPolicyReleaseSchema,
    decisionTimeoutMs: DecisionTimeoutMsSchema,
  })
  .strict();

export type PolicyReleaseRecord = z.infer<typeof PolicyReleaseRecordSchema>;
export type BotBlockerPolicyResponse = z.infer<
  typeof BotBlockerPolicyResponseSchema
>;
