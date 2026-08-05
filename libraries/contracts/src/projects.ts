import { z } from "zod";

import { VerificationTypeSchema } from "./verification.js";

export const ProjectNameSchema = z.string().trim().min(2).max(80);
export const ProjectSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "HTTPS is required");

export const CreateProjectSchema = z.object({
  name: ProjectNameSchema,
  enabledMethods: z.array(VerificationTypeSchema).min(1).default(["call_reachability"]),
  allowedOrigins: z.array(HttpsUrlSchema).max(20).default([]),
  callbackUrl: HttpsUrlSchema.optional(),
});

export const UpdateProjectSchema = z
  .object({
    name: ProjectNameSchema.optional(),
    enabledMethods: z.array(VerificationTypeSchema).min(1).optional(),
    allowedOrigins: z.array(HttpsUrlSchema).max(20).optional(),
    callbackUrl: HttpsUrlSchema.nullable().optional(),
    active: z.boolean().optional(),
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
