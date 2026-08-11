import { z } from "zod";

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
  .refine((value) => new URL(value).protocol === "https:", "HTTPS is required");

/** A customer-entered display name used only to brand `email_code`
 * delivery emails sent to their own end users (see
 * `apps/api/src/email-otp-service.ts`) — never shown anywhere else. */
export const BrandNameSchema = z.string().trim().min(1).max(80);
/**
 * A link to an already-hosted logo image, pasted in by the customer — not
 * a file upload. DigitalOcean Spaces (the bucket this project already uses
 * for `voice_challenge` recordings) isn't provisioned for arbitrary
 * customer-uploaded images yet; revisit a real upload flow once it is. See
 * `docs/AS_BUILT.md`'s "Customer signup flow" / branding section.
 */
export const BrandLogoUrlSchema = HttpsUrlSchema;

export const CreateProjectSchema = z.object({
  name: ProjectNameSchema,
  enabledMethods: z.array(VerificationTypeSchema).min(1).default(["call_reachability"]),
  allowedOrigins: z.array(HttpsUrlSchema).max(20).default([]),
  callbackUrl: HttpsUrlSchema.optional(),
  brandName: BrandNameSchema.optional(),
  brandLogoUrl: BrandLogoUrlSchema.optional(),
});

export const UpdateProjectSchema = z
  .object({
    name: ProjectNameSchema.optional(),
    enabledMethods: z.array(VerificationTypeSchema).min(1).optional(),
    allowedOrigins: z.array(HttpsUrlSchema).max(20).optional(),
    callbackUrl: HttpsUrlSchema.nullable().optional(),
    active: z.boolean().optional(),
    brandName: BrandNameSchema.nullable().optional(),
    brandLogoUrl: BrandLogoUrlSchema.nullable().optional(),
  })
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
  stats: ProjectStatsSchema,
});

/**
 * Same shape as a project's own `stats`, but aggregated across every
 * project on the platform — the admin "operator health" usage view (see
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section and
 * `apps/api/src/verification-reporting.ts#computePlatformStats`).
 */
export const PlatformUsageResponseSchema = z.object({
  stats: ProjectStatsSchema,
});

export const ProjectCreatedSchema = z.object({
  project: ProjectSchema,
  apiKey: z.string().min(32),
  callbackSigningSecret: z.string().min(32).optional(),
});

export const RotatedSecretSchema = z.object({
  value: z.string().min(32),
});

export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectCreated = z.infer<typeof ProjectCreatedSchema>;
export type PlatformUsageResponse = z.infer<typeof PlatformUsageResponseSchema>;
