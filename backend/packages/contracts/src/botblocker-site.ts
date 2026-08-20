import { z } from "zod";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BotBlockerWebhookIdSchema,
  DecisionTimeoutMsSchema,
  SiteIdSchema,
} from "./botblocker.js";
import {
  verificationTypes,
  VerificationTypeSchema,
  type VerificationType,
} from "./verification.js";

export const BotBlockerOtpMethodMarkerSchema = z
  .object({
    method: VerificationTypeSchema,
    enabled: z.boolean(),
    triggerScore: z.number().int().min(0).max(100),
  })
  .strict();

export const BotBlockerOtpMethodMarkersSchema = z
  .array(BotBlockerOtpMethodMarkerSchema)
  .length(verificationTypes.length)
  .superRefine((markers, context) => {
    const methods = new Set(markers.map(({ method }) => method));
    for (const method of verificationTypes) {
      if (!methods.has(method)) {
        context.addIssue({
          code: "custom",
          message: `Missing OTP marker for ${method}`,
        });
      }
    }
    if (methods.size !== verificationTypes.length) {
      context.addIssue({
        code: "custom",
        message: "Each OTP method must have exactly one marker",
      });
    }

    const enabledScores = new Set<number>();
    markers.forEach((marker, index) => {
      if (!marker.enabled) return;
      if (enabledScores.has(marker.triggerScore)) {
        context.addIssue({
          code: "custom",
          message: "Enabled OTP markers must use distinct trigger scores",
          path: [index, "triggerScore"],
        });
      }
      enabledScores.add(marker.triggerScore);
    });
  });

export const DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS = [
  { method: "call_reachability", enabled: false, triggerScore: 20 },
  { method: "voice_code", enabled: false, triggerScore: 40 },
  { method: "voice_challenge", enabled: false, triggerScore: 60 },
  { method: "sms_code", enabled: false, triggerScore: 80 },
  { method: "email_code", enabled: false, triggerScore: 100 },
] as const satisfies readonly BotBlockerOtpMethodMarker[];

/**
 * Customer-visible, project-scoped BotBlocker settings. Site credentials,
 * signing keys, and other server-only configuration are intentionally absent.
 * `webhookId` is the immutable self-validating path token every runtime route requires (see
 * `BotBlockerWebhookIdSchema`); it is provisioned automatically the moment
 * the project exists and is safe to display to the customer immediately.
 */
export const BotBlockerSiteConfigurationSchema = z
  .object({
    siteId: SiteIdSchema,
    projectId: z.string().min(16),
    webhookId: BotBlockerWebhookIdSchema,
    enabled: z.boolean(),
    decisionTimeoutMs: DecisionTimeoutMsSchema,
    otpMethodMarkers: BotBlockerOtpMethodMarkersSchema,
    otpPolicyVersion: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UpdateBotBlockerSiteConfigurationSchema = z
  .object({
    enabled: z.boolean().optional(),
    decisionTimeoutMs: DecisionTimeoutMsSchema.optional(),
    otpMethodMarkers: BotBlockerOtpMethodMarkersSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const DEFAULT_BOTBLOCKER_SITE_CONFIGURATION = {
  enabled: false,
  decisionTimeoutMs: BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
  otpPolicyVersion: 0,
} as const;

export type BotBlockerOtpMethodMarker = z.infer<
  typeof BotBlockerOtpMethodMarkerSchema
>;
export type BotBlockerOtpMethodMarkers = z.infer<
  typeof BotBlockerOtpMethodMarkersSchema
>;
export type BotBlockerOtpPolicyDecision =
  | { outcome: "allow" }
  | { outcome: "otp"; method: VerificationType };

export function resolveBotBlockerOtpPolicy(
  score: number,
  markers: readonly BotBlockerOtpMethodMarker[],
): BotBlockerOtpPolicyDecision {
  const selected = markers
    .filter((marker) => marker.enabled && marker.triggerScore <= score)
    .sort((left, right) => right.triggerScore - left.triggerScore)[0];
  return selected
    ? { outcome: "otp", method: selected.method }
    : { outcome: "allow" };
}

export type BotBlockerSiteConfiguration = z.infer<
  typeof BotBlockerSiteConfigurationSchema
>;
export type UpdateBotBlockerSiteConfiguration = z.infer<
  typeof UpdateBotBlockerSiteConfigurationSchema
>;
