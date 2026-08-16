import { z } from "zod";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BotBlockerWebhookIdSchema,
  DecisionTimeoutMsSchema,
  SiteIdSchema,
} from "./botblocker.js";

/**
 * Customer-visible, project-scoped BotBlocker settings. Site credentials,
 * signing keys, and other server-only configuration are intentionally absent.
 * `webhookId` is the opaque path segment every runtime route requires (see
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
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UpdateBotBlockerSiteConfigurationSchema = z
  .object({
    enabled: z.boolean().optional(),
    decisionTimeoutMs: DecisionTimeoutMsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const DEFAULT_BOTBLOCKER_SITE_CONFIGURATION = {
  enabled: false,
  decisionTimeoutMs: BOTBLOCKER_TIMEOUT_DEFAULT_MS,
} as const;

export type BotBlockerSiteConfiguration = z.infer<
  typeof BotBlockerSiteConfigurationSchema
>;
export type UpdateBotBlockerSiteConfiguration = z.infer<
  typeof UpdateBotBlockerSiteConfigurationSchema
>;
