import { z } from "zod";

import { TargetNumberSchema, VerificationTypeSchema } from "./verification.js";

/**
 * A "modal session" exists before any interaction does — it is created by
 * a customer's own backend (with its project API key) purely to hand the
 * end user a POWEROTP-hosted, POWEROTP-branded modal (`/widget/{sessionId}`)
 * that collects the end user's own phone number and drives the call/SMS/
 * code/challenge flow. This is the missing piece for a customer who only
 * needs the plain OTP function and does not already know the end user's
 * number up front (today's `POST /v1/projects/{slug}/verifications`
 * requires the caller to supply `targetNumber`, which doesn't fit this
 * flow). See `docs/AS_BUILT.md`'s "Hosted verification modal" section.
 */
export const ModalSessionCreateSchema = z.object({
  /**
   * Which verification methods the modal may offer the end user. Always
   * validated server-side against the project's own `enabledMethods` —
   * never trusted at face value. Defaults to every method the project has
   * enabled if omitted.
   */
  allowedTypes: z.array(VerificationTypeSchema).min(1).optional(),
});

export const ModalSessionAcceptedSchema = z.object({
  sessionId: z.string().min(16),
  modalUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

/**
 * What the hosted `/widget/{sessionId}` page itself fetches on load to
 * render the right UI — never includes anything a project's own API key
 * would (no secrets, no callback URL, no raw project id).
 */
export const ModalSessionConfigSchema = z.object({
  sessionId: z.string().min(16),
  projectName: z.string().min(1),
  allowedTypes: z.array(VerificationTypeSchema).min(1),
  attemptsRemaining: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});

/**
 * What the end user's browser submits, from inside the hosted modal, once
 * they've typed their own phone number and (if more than one method is
 * allowed) picked one — the session id itself is the credential, not a
 * project API key. Deliberately the same shape as `CreateVerificationSchema`
 * minus `browserResponse`, which the session-scoped route always forces to
 * `true` server-side, since the modal itself is what submits the follow-up
 * code/challenge response.
 */
export const ModalSessionVerificationRequestSchema = z
  .object({
    type: VerificationTypeSchema,
    targetNumber: TargetNumberSchema,
    code: z.string().regex(/^\d{5}$/).optional(),
  })
  .superRefine((request, context) => {
    if (request.code && request.type !== "voice_code") {
      context.addIssue({
        code: "custom",
        message: "A client code is supported only for voice_code",
        path: ["code"],
      });
    }
  });

/**
 * What the hosted modal receives back after it submits the end user's
 * phone number: the same shape as `VerificationAcceptedSchema`, plus a
 * second, separate `statusToken` (a `view_status`-scoped interaction
 * token) — the modal polls `GET /v1/verifications/{interactionId}` with
 * this token from the browser, since it never holds a project API key.
 * Kept as its own schema rather than widening `VerificationAcceptedSchema`
 * itself, since the customer create route never needs a status token (its
 * caller already has an API key).
 */
export const ModalSessionVerificationAcceptedSchema = z.object({
  interactionId: z.string().min(16),
  state: z.literal("queued"),
  statusUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  statusToken: z.string(),
  interactionToken: z.string().optional(),
});

/**
 * Read-only admin visibility into a recent real end-user widget
 * interaction — `endUserIp`/`endUserUserAgent` are captured directly from
 * the end user's own browser request to the hosted modal, never from
 * anything a customer's site could set itself. Visibility/audit only for
 * now; no fraud/risk scoring is attached to this yet. See
 * `docs/AS_BUILT.md`'s "Hosted verification modal" section.
 */
export const WidgetInteractionSummarySchema = z.object({
  interactionId: z.string().min(16),
  occurredAt: z.string().datetime(),
  type: VerificationTypeSchema,
  state: z.string().min(1),
  maskedTarget: z.string().min(1),
  endUserIp: z.string().optional(),
  endUserUserAgent: z.string().optional(),
});

export const WidgetInteractionsResponseSchema = z.object({
  interactions: z.array(WidgetInteractionSummarySchema),
});

export type ModalSessionCreate = z.infer<typeof ModalSessionCreateSchema>;
export type ModalSessionAccepted = z.infer<typeof ModalSessionAcceptedSchema>;
export type ModalSessionConfig = z.infer<typeof ModalSessionConfigSchema>;
export type ModalSessionVerificationRequest = z.infer<
  typeof ModalSessionVerificationRequestSchema
>;
export type ModalSessionVerificationAccepted = z.infer<
  typeof ModalSessionVerificationAcceptedSchema
>;
export type WidgetInteractionSummary = z.infer<typeof WidgetInteractionSummarySchema>;
export type WidgetInteractionsResponse = z.infer<typeof WidgetInteractionsResponseSchema>;
