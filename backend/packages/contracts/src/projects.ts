import { z } from "zod";

import {
  BotBlockerWebhookIdSchema,
  SiteIdSchema,
} from "./botblocker.js";
import { HostedAuthIdentityDataModeSchema } from "./hosted-auth-boundaries.js";
import { ProjectIdentifierStringSchema } from "./hosted-auth-identifiers.js";
import {
  HostedAuthProjectSettingsSchema,
  HostedAuthReturnUrlsSchema,
} from "./hosted-auth-project-configuration.js";
import { VerificationTypeSchema } from "./verification.js";

export const ProjectNameSchema = z.string().trim().min(2).max(80);
export const ProjectSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "HTTPS is required");

/** A customer-entered display name used only to brand `email_code`
 * delivery emails sent to their own end users (see
 * `backend/packages/api/src/email-otp-service.ts`) — never shown anywhere else. */
export const BrandNameSchema = z.string().trim().min(1).max(80);
/**
 * A link to an already-hosted logo image, pasted in by the customer — not
 * a file upload. DigitalOcean Spaces (the bucket this project already uses
 * for `voice_challenge` recordings) isn't provisioned for arbitrary
 * customer-uploaded images yet; revisit a real upload flow once it is. See
 * `docs/AS_BUILT.md`'s "Customer signup flow" / branding section.
 */
export const BrandLogoUrlSchema = HttpsUrlSchema;

/** A customer's own address for replies to their `email_code` delivery
 * emails — Brevo's `replyTo` is completely independent of `sender` and
 * needs no domain verification (unlike the `sender`/"From" address, which
 * must stay our own verified domain — see `backend/packages/api/src/email-otp-service.ts`'s
 * doc comment for why we can't send "From" a customer's own domain). */
export const BrandReplyToEmailSchema = z.string().trim().toLowerCase().email().max(320);

const CODE_PLACEHOLDER = "{{CODE}}";
/**
 * A customer's own complete HTML email body for `email_code` delivery,
 * pasted in as-is — replaces the auto-generated brand-name/logo template
 * entirely once set (see `backend/packages/api/src/email-otp-service.ts`). Must contain
 * the literal `{{CODE}}` placeholder, substituted with the real one-time
 * code at send time; nothing else in the customer's HTML is parsed or
 * modified. Never sent to Brevo's own shared template library — this is
 * passed directly as `htmlContent` on each send, so it stays private to
 * this project in our own database.
 */
export const BrandHtmlTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(20_000)
  .refine((value) => value.includes(CODE_PLACEHOLDER), `Must include the literal ${CODE_PLACEHOLDER} placeholder`);

export const CreateProjectSchema = z
  .object({
    name: ProjectNameSchema,
    identityDataMode: HostedAuthIdentityDataModeSchema,
    enabledMethods: z.array(VerificationTypeSchema).min(1).default(["call_reachability"]),
    allowedOrigins: z.array(HttpsUrlSchema).max(20).default([]),
    callbackUrl: HttpsUrlSchema.optional(),
    brandName: BrandNameSchema.optional(),
    brandLogoUrl: BrandLogoUrlSchema.optional(),
    brandReplyToEmail: BrandReplyToEmailSchema.optional(),
    brandHtmlTemplate: BrandHtmlTemplateSchema.optional(),
  })
  .strict();

export const UpdateProjectSchema = z
  .object({
    name: ProjectNameSchema.optional(),
    enabledMethods: z.array(VerificationTypeSchema).min(1).optional(),
    allowedOrigins: z.array(HttpsUrlSchema).max(20).optional(),
    callbackUrl: HttpsUrlSchema.nullable().optional(),
    active: z.boolean().optional(),
    brandName: BrandNameSchema.nullable().optional(),
    brandLogoUrl: BrandLogoUrlSchema.nullable().optional(),
    brandReplyToEmail: BrandReplyToEmailSchema.nullable().optional(),
    brandHtmlTemplate: BrandHtmlTemplateSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const ProjectStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  byType: z.record(VerificationTypeSchema, z.number().int().nonnegative()),
});

export const ProjectSchema = z.object({
  id: z.string().min(16),
  name: ProjectNameSchema,
  slug: ProjectSlugSchema,
  apiUrl: z.string().url(),
  enabledMethods: z.array(VerificationTypeSchema),
  allowedOrigins: z.array(HttpsUrlSchema),
  callbackUrl: HttpsUrlSchema.optional(),
  callbackConfigured: z.boolean(),
  active: z.boolean(),
  activatedAt: z.string().datetime(),
  apiKeyPrefix: z.string().optional(),
  apiKeyLastFour: z.string().length(4).optional(),
  brandName: BrandNameSchema.optional(),
  brandLogoUrl: BrandLogoUrlSchema.optional(),
  brandReplyToEmail: BrandReplyToEmailSchema.optional(),
  brandHtmlTemplate: BrandHtmlTemplateSchema.optional(),
  identityDataMode: HostedAuthIdentityDataModeSchema,
  identifierString: ProjectIdentifierStringSchema,
  authRealm: z.string().url(),
  rpId: z.string().min(1).max(253),
  signupHostedUrl: z.string().url(),
  signinHostedUrl: z.string().url(),
  authSettings: HostedAuthProjectSettingsSchema,
  authReturnUrls: HostedAuthReturnUrlsSchema.optional(),
  stats: ProjectStatsSchema,
});

/**
 * Same shape as a project's own `stats`, but aggregated across every
 * project on the platform — the admin "operator health" usage view (see
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section and
 * `backend/packages/api/src/verification-reporting.ts#computePlatformStats`).
 */
export const PlatformUsageResponseSchema = z.object({
  stats: ProjectStatsSchema,
});

export const BotBlockerProjectSetupSchema = z
  .object({
    siteId: SiteIdSchema,
    webhookId: BotBlockerWebhookIdSchema,
    webhookSigningSecret: z.string().min(32),
  })
  .strict();

export const ProjectCreatedSchema = z.object({
  project: ProjectSchema,
  apiKey: z.string().min(32),
  callbackSigningSecret: z.string().min(32).optional(),
  botBlocker: BotBlockerProjectSetupSchema,
});

export const RotatedSecretSchema = z.object({
  value: z.string().min(32),
});

export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type BotBlockerProjectSetup = z.infer<
  typeof BotBlockerProjectSetupSchema
>;
export type ProjectCreated = z.infer<typeof ProjectCreatedSchema>;
export type PlatformUsageResponse = z.infer<typeof PlatformUsageResponseSchema>;
