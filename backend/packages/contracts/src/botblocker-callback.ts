import { z } from "zod";

import {
  BotBlockerDecisionOutcomeSchema,
  SiteIdSchema,
} from "./botblocker.js";
import { ProfileScoreStatusSchema } from "./botblocker-scoring.js";

const OpaqueIdSchema = z.string().min(16).max(128);
const CallbackNonceSchema = z
  .string()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * Notification-only project callback. It contains no score, fingerprint,
 * IP evidence, credential, or visitor bearer. The receiver must pull the
 * authoritative session record with its server-held scoped visitor token.
 */
export const BotBlockerDataReadyCallbackEventSchema = z
  .object({
    eventId: OpaqueIdSchema,
    type: z.literal("botblocker.session_data_ready"),
    projectId: OpaqueIdSchema,
    siteId: SiteIdSchema,
    gateSessionId: OpaqueIdSchema,
    occurredAt: z.string().datetime(),
    nonce: CallbackNonceSchema,
  })
  .strict();

export const BotBlockerDataReadyCallbackEnvelopeSchema = z
  .object({
    apiVersion: z.literal("2026-08-04"),
    event: BotBlockerDataReadyCallbackEventSchema,
  })
  .strict();

/**
 * Authoritative server-to-server pull result. Unlike the callback, this
 * response may carry the current score because it is returned only after
 * scoped visitor-token authentication.
 */
export const BotBlockerSessionDataResponseSchema = z
  .object({
    apiVersion: z.literal("2026-08-04"),
    eventId: OpaqueIdSchema,
    projectId: OpaqueIdSchema,
    siteId: SiteIdSchema,
    gateSessionId: OpaqueIdSchema,
    currentScore: ProfileScoreStatusSchema,
    decision: BotBlockerDecisionOutcomeSchema.optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type BotBlockerDataReadyCallbackEvent = z.infer<
  typeof BotBlockerDataReadyCallbackEventSchema
>;
export type BotBlockerDataReadyCallbackEnvelope = z.infer<
  typeof BotBlockerDataReadyCallbackEnvelopeSchema
>;
export type BotBlockerSessionDataResponse = z.infer<
  typeof BotBlockerSessionDataResponseSchema
>;
