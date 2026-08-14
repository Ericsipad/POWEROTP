import { z } from "zod";

import { BotBlockerProtocolVersionSchema, SiteIdSchema } from "./botblocker.js";
import {
  BotBlockerEd25519SignatureSchema,
  BotBlockerSigningKeyIdSchema,
} from "./botblocker-signing.js";

/**
 * BotBlocker signed-policy contracts (Phase 2 of
 * `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`). Mirrors the field list
 * in `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Signed Policy Client" section:
 * version, activation, expiration, site audience, protocol compatibility,
 * risk weights, challenge mapping, edge endpoints, sensor version,
 * verification keys, dataset versions, and revocation-filter metadata.
 *
 * No Ed25519 signature exists yet (Phase 3), so this is the unsigned
 * *payload* shape only — `verificationKeys` here is an opaque key-id
 * reference list (no key material, no signature), and there is no
 * `signature` field on this object at all. `riskWeights` is an opaque
 * versioned blob, never real weights (those are Phase 17) — the schema
 * validates only that a model version and payload exist, not their
 * content.
 */

export const PolicyKeyReferenceSchema = z
  .object({
    keyId: z.string().min(1).max(128),
  })
  .strict();

export const PolicyRiskWeightsBlobSchema = z
  .object({
    modelVersion: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const PolicyChallengeMappingEntrySchema = z
  .object({
    riskBand: z.string().min(1).max(64),
    challengeKind: z.string().min(1).max(64),
  })
  .strict();

export const PolicyEdgeEndpointSchema = z
  .object({
    region: z.string().min(1).max(64),
    url: z.string().url(),
  })
  .strict();

export const PolicyRevocationFilterMetadataSchema = z
  .object({
    filterVersion: z.number().int().positive(),
    checksumSha256: z.string().length(64),
  })
  .strict();

/**
 * The site audience and `protocolVersion` literal are what make this
 * "protocol compatibility"-checked: a policy targeting a different site, or
 * built for a wire-protocol version this contracts module doesn't export,
 * fails schema validation before any activation/expiration logic runs.
 */
export const BotBlockerPolicySchema = z
  .object({
    policyVersion: z.number().int().positive(),
    protocolVersion: BotBlockerProtocolVersionSchema,
    siteId: SiteIdSchema,
    activatesAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    riskWeights: PolicyRiskWeightsBlobSchema,
    challengeMapping: z.array(PolicyChallengeMappingEntrySchema).max(100),
    edgeEndpoints: z.array(PolicyEdgeEndpointSchema).max(50),
    sensorVersion: z.string().min(1).max(64),
    verificationKeys: z.array(PolicyKeyReferenceSchema).min(1).max(10),
    datasetVersions: z.record(z.string(), z.string().min(1).max(64)),
    revocationFilter: PolicyRevocationFilterMetadataSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.expiresAt <= policy.activatesAt) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be after activatesAt",
        path: ["expiresAt"],
      });
    }
  });

/**
 * The signed release wraps the Phase 2 policy payload rather than weakening
 * that payload with optional signature fields. Audience, nonce, and issuance
 * are part of the signed envelope; site and expiry remain authoritative in
 * the policy itself and are included in the signed bytes.
 */
export const SignedBotBlockerPolicyReleaseSchema = z
  .object({
    signatureStatus: z.literal("signed"),
    keyId: BotBlockerSigningKeyIdSchema,
    signature: BotBlockerEd25519SignatureSchema,
    audience: z.string().min(1),
    nonce: z.string().min(16),
    issuedAt: z.number().int().positive(),
    policy: BotBlockerPolicySchema,
  })
  .strict()
  .superRefine((release, context) => {
    if (release.issuedAt >= release.policy.expiresAt) {
      context.addIssue({
        code: "custom",
        message: "issuedAt must be before the policy expires",
        path: ["issuedAt"],
      });
    }
  });

/**
 * Pure version-regression check, mirroring `botblocker.ts`'s
 * `isStaleSequence` pattern exactly: equal-or-older than the currently
 * active policy is a rejectable rollback, even though no signature or
 * storage enforces it yet (signed rollback protection is Phase 3/7). A
 * caller with no currently-active policy never treats the candidate as a
 * rollback.
 */
export function isPolicyVersionRegression(
  candidate: Pick<BotBlockerPolicy, "policyVersion">,
  currentlyActive: Pick<BotBlockerPolicy, "policyVersion"> | undefined,
): boolean {
  if (!currentlyActive) return false;
  return candidate.policyVersion <= currentlyActive.policyVersion;
}

export type PolicyKeyReference = z.infer<typeof PolicyKeyReferenceSchema>;
export type PolicyRiskWeightsBlob = z.infer<typeof PolicyRiskWeightsBlobSchema>;
export type PolicyChallengeMappingEntry = z.infer<typeof PolicyChallengeMappingEntrySchema>;
export type PolicyEdgeEndpoint = z.infer<typeof PolicyEdgeEndpointSchema>;
export type PolicyRevocationFilterMetadata = z.infer<typeof PolicyRevocationFilterMetadataSchema>;
export type BotBlockerPolicy = z.infer<typeof BotBlockerPolicySchema>;
export type SignedBotBlockerPolicyRelease = z.infer<
  typeof SignedBotBlockerPolicyReleaseSchema
>;
