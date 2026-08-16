import { z } from "zod";

import {
  BotBlockerProtocolVersionSchema,
  BrowserEvidenceSchema,
  ReportSequenceSchema,
} from "./botblocker.js";
import { SignedSiteClearanceSchema } from "./botblocker-clearance.js";
import {
  PaidTokenPassAssertionSchema,
  PassportAssertionSchema,
} from "./botblocker-proofs.js";

/**
 * Bounded, browser-presentable material for an initial assessment. These are
 * only candidate proofs: the adapter and POWEROTP remain responsible for
 * verification and never accept a browser-declared approval.
 */
export const InitialBrowserProofEvidenceSchema = z
  .object({
    protocolVersion: BotBlockerProtocolVersionSchema,
    evidence: BrowserEvidenceSchema,
    proofs: z
      .object({
        clearance: SignedSiteClearanceSchema.optional(),
        passport: PassportAssertionSchema.optional(),
        paidTokenPass: PaidTokenPassAssertionSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const gateRecommendationValues = [
  "restricted",
  "full_access",
  "otp_required",
] as const;
export const GateRecommendationSchema = z.enum(gateRecommendationValues);

export const gateLifecycleValues = [
  "checking",
  "fail_open",
  "offline",
  "observing",
  "otp_required",
  "verified",
  "unavailable",
] as const;
export const GateLifecycleSchema = z.enum(gateLifecycleValues);

/**
 * Public browser state. Recommendation and lifecycle deliberately remain
 * distinct from the only backend decisions, allow and otp.
 */
const snapshotCommon = {
  decisionPending: z.boolean(),
  lastApplied: ReportSequenceSchema.optional(),
};

export const GateRecommendationSnapshotSchema = z.discriminatedUnion("lifecycle", [
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("checking"),
    recommendation: z.literal("restricted"),
    otpOpen: z.literal(false),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("fail_open"),
    recommendation: z.literal("full_access"),
    otpOpen: z.literal(false),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("unavailable"),
    recommendation: z.literal("full_access"),
    otpOpen: z.literal(false),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("offline"),
    recommendation: z.literal("full_access"),
    otpOpen: z.literal(false),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("observing"),
    recommendation: z.literal("full_access"),
    decision: z.literal("allow"),
    otpOpen: z.literal(false),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("otp_required"),
    recommendation: z.literal("otp_required"),
    decision: z.literal("otp"),
    otpOpen: z.boolean(),
  }).strict(),
  z.object({
    ...snapshotCommon,
    lifecycle: z.literal("verified"),
    recommendation: z.literal("full_access"),
    decision: z.literal("otp"),
    otpOpen: z.literal(false),
  }).strict(),
]);

/** The opener has no caller-selectable request fields or JSON body. */
export const EmptyOtpOpenRequestSchema = z.undefined();

/**
 * Short-lived server-selected iframe launch metadata. The browser receives no
 * method, policy, customer credential, or authorization token.
 */
export const OtpLaunchMetadataSchema = z
  .object({
    challengeId: z.string().min(16).max(200),
    challengeUrl: z.string().url().max(2_048),
    challengeOrigin: z.string().url().max(2_048),
  })
  .strict()
  .superRefine((metadata, context) => {
    try {
      const challengeUrl = new URL(metadata.challengeUrl);
      const challengeOrigin = new URL(metadata.challengeOrigin);
      if (
        challengeUrl.protocol !== "https:" ||
        challengeOrigin.protocol !== "https:" ||
        challengeUrl.username ||
        challengeUrl.password ||
        challengeOrigin.username ||
        challengeOrigin.password ||
        challengeOrigin.toString() !== `${challengeOrigin.origin}/` ||
        challengeUrl.origin !== challengeOrigin.origin
      ) {
        context.addIssue({
          code: "custom",
          message: "Challenge metadata must use its credential-free approved HTTPS origin",
          path: ["challengeUrl"],
        });
      }
    } catch {
      // The URL schemas above report malformed URL values.
    }
  });

export type InitialBrowserProofEvidence = z.infer<typeof InitialBrowserProofEvidenceSchema>;
export type GateRecommendation = z.infer<typeof GateRecommendationSchema>;
export type GateLifecycle = z.infer<typeof GateLifecycleSchema>;
export type GateRecommendationSnapshot = z.infer<typeof GateRecommendationSnapshotSchema>;
export type OtpLaunchMetadata = z.infer<typeof OtpLaunchMetadataSchema>;
