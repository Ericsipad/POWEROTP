import { z } from "zod";

import { SiteIdSchema } from "./botblocker.js";
import {
  BotBlockerEd25519SignatureSchema,
  BotBlockerSigningKeyIdSchema,
} from "./botblocker-signing.js";

/**
 * BotBlocker site-clearance contracts (Phase 2 of
 * `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`). This is the unsigned
 * contract *shape* only — see `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Tokens
 * and cookies" section (`powerotp_access`) and `docs/THREAT_MODEL.md`'s
 * "Forged clearance and signed policy". Ed25519 signing is Phase 3.
 *
 * `signatureStatus` is a discriminant, not a boolean flag, specifically so
 * "this clearance carries no signature" is a fact the schema expresses
 * structurally rather than something a caller could forget to check:
 * `UnsignedSiteClearanceSchema` has no `signature`/`keyId` field at all (an
 * excess field is rejected by `.strict()` — see
 * `botblocker-clearance.test.ts`). `SiteClearanceSchema` keeps that shape
 * beside the Phase 3 `SignedSiteClearanceSchema`, whose required key ID and
 * Ed25519 signature make the two wire variants structurally distinct.
 */

const SiteClearanceClaimsShape = {
  siteId: SiteIdSchema,
  gateSessionId: z.string().min(16),
  audience: z.string().min(1),
  nonce: z.string().min(16),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
};

function requireValidClearanceLifetime(
  clearance: { issuedAt: number; expiresAt: number },
  context: z.RefinementCtx,
): void {
  if (clearance.expiresAt <= clearance.issuedAt) {
    context.addIssue({
      code: "custom",
      message: "expiresAt must be after issuedAt",
      path: ["expiresAt"],
    });
  }
}

export const UnsignedSiteClearanceSchema = z
  .object({
    signatureStatus: z.literal("unsigned"),
    ...SiteClearanceClaimsShape,
  })
  .strict()
  .superRefine(requireValidClearanceLifetime);

export const SignedSiteClearanceSchema = z
  .object({
    signatureStatus: z.literal("signed"),
    ...SiteClearanceClaimsShape,
    keyId: BotBlockerSigningKeyIdSchema,
    signature: BotBlockerEd25519SignatureSchema,
  })
  .strict()
  .superRefine(requireValidClearanceLifetime);

export const SiteClearanceSchema = z.discriminatedUnion("signatureStatus", [
  UnsignedSiteClearanceSchema,
  SignedSiteClearanceSchema,
]);

export type UnsignedSiteClearance = z.infer<typeof UnsignedSiteClearanceSchema>;
export type SignedSiteClearance = z.infer<typeof SignedSiteClearanceSchema>;
export type SiteClearance = z.infer<typeof SiteClearanceSchema>;
