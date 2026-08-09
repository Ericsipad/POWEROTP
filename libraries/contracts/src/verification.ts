import { z } from "zod";

export const verificationTypes = [
  "call_reachability",
  "voice_code",
  "voice_challenge",
  "sms_code",
] as const;

export const verificationStates = [
  "queued",
  "dispatching",
  "calling",
  "ringing",
  "answered",
  "playing",
  "awaiting_response",
  "succeeded",
  "failed",
  "expired",
  "canceled",
] as const;

export const terminalVerificationStates = [
  "succeeded",
  "failed",
  "expired",
  "canceled",
] as const;

export const accountClasses = ["customer", "platform_admin"] as const;

export const VerificationTypeSchema = z.enum(verificationTypes);
export const VerificationStateSchema = z.enum(verificationStates);
export const AccountClassSchema = z.enum(accountClasses);

export const TargetNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format");

export const CreateVerificationSchema = z
  .object({
    type: VerificationTypeSchema,
    targetNumber: TargetNumberSchema,
    code: z.string().regex(/^\d{5}$/).optional(),
    browserResponse: z.boolean().default(false),
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

export const VerificationAcceptedSchema = z.object({
  interactionId: z.string().min(16),
  state: z.literal("queued"),
  statusUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  interactionToken: z.string().optional(),
});

export const InteractionTokenClaimsSchema = z.object({
  projectId: z.string().min(16),
  interactionId: z.string().min(16),
  /**
   * `view_status` is read-only (never single-use consumed, unlike
   * `submit_code`/`submit_challenge`) — see
   * `apps/api/src/modal-session-service.ts` and `docs/AS_BUILT.md`'s
   * "Hosted verification modal" section for why the hosted modal needs to
   * poll status from the browser using only the session-scoped token, with
   * no project API key ever reaching the browser.
   */
  action: z.enum(["submit_code", "submit_challenge", "view_status"]),
  audience: z.string().min(1),
  nonce: z.string().min(16),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export const ChallengeOptionSchema = z.object({
  id: z.string().min(16),
  label: z.string().min(1).max(2_000),
});

export const ChallengeSchema = z
  .object({
    challengeId: z.string().min(16),
    question: z.string().min(1).max(4_000),
    options: z.array(ChallengeOptionSchema).min(2).max(100),
    allowsMultiple: z.boolean(),
    minSelections: z.number().int().positive(),
    maxSelections: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .superRefine((challenge, context) => {
    if (challenge.minSelections > challenge.maxSelections) {
      context.addIssue({
        code: "custom",
        message: "minSelections cannot exceed maxSelections",
        path: ["minSelections"],
      });
    }
    if (challenge.maxSelections > challenge.options.length) {
      context.addIssue({
        code: "custom",
        message: "maxSelections cannot exceed the number of options",
        path: ["maxSelections"],
      });
    }
    if (!challenge.allowsMultiple && challenge.maxSelections !== 1) {
      context.addIssue({
        code: "custom",
        message: "Single-answer challenges must allow exactly one selection",
        path: ["maxSelections"],
      });
    }
  });

export const ChallengeSubmissionSchema = z.object({
  optionIds: z.array(z.string().min(16)).min(1).max(100),
});

export const CodeSubmissionSchema = z.object({
  code: z.string().regex(/^\d{5}$/),
});

export const VerificationEventSchema = z.object({
  eventId: z.string().min(16),
  interactionId: z.string().min(16),
  sequence: z.number().int().positive(),
  type: VerificationTypeSchema,
  state: VerificationStateSchema,
  occurredAt: z.string().datetime(),
  reasonCode: z.string().min(1).max(100).optional(),
});

export const CallbackEnvelopeSchema = z.object({
  apiVersion: z.literal("2026-08-04"),
  event: VerificationEventSchema,
});

export const VerificationStatusSchema = z.object({
  interactionId: z.string().min(16),
  type: VerificationTypeSchema,
  state: VerificationStateSchema,
  reasonCode: z.string().min(1).max(100).optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  challenge: ChallengeSchema.optional(),
});

/**
 * A reduced request shape for the public, anonymous "try it now" demo
 * endpoint: no idempotency key, code, or browser-response negotiation, and
 * it is only ever accepted for the operator-configured demo project.
 */
export const DemoVerificationRequestSchema = z.object({
  type: VerificationTypeSchema,
  targetNumber: TargetNumberSchema,
});

export const InteractionSummarySchema = z.object({
  interactionId: z.string().min(16),
  occurredAt: z.string().datetime(),
  type: VerificationTypeSchema,
  state: VerificationStateSchema,
  maskedTarget: z.string().min(1),
  durationMs: z.number().int().nonnegative().optional(),
  correlationId: z.string().min(1).optional(),
});

/**
 * Read-only view of one recorded callback delivery attempt (see
 * `apps/api/src/callback-worker.ts`, which already writes one of these on
 * every attempt) — surfaced on `/admin` for callback delivery diagnostics
 * (`docs/AS_BUILT.md`'s "Admin operator health dashboard" section). Nothing
 * new is captured here; this just makes already-recorded data visible.
 */
export const CallbackDeliverySummarySchema = z.object({
  id: z.string().min(1),
  interactionId: z.string().min(16),
  eventId: z.string().min(16),
  projectId: z.string().min(16),
  attempt: z.number().int().positive(),
  status: z.enum(["delivered", "failed"]),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
  occurredAt: z.string().datetime(),
});

export const CallbackDeliveriesResponseSchema = z.object({
  deliveries: z.array(CallbackDeliverySummarySchema),
});

export type VerificationType = z.infer<typeof VerificationTypeSchema>;
export type VerificationState = z.infer<typeof VerificationStateSchema>;
export type AccountClass = z.infer<typeof AccountClassSchema>;
export type CreateVerification = z.infer<typeof CreateVerificationSchema>;
export type VerificationAccepted = z.infer<typeof VerificationAcceptedSchema>;
export type InteractionTokenClaims = z.infer<typeof InteractionTokenClaimsSchema>;
export type Challenge = z.infer<typeof ChallengeSchema>;
export type ChallengeSubmission = z.infer<typeof ChallengeSubmissionSchema>;
export type CodeSubmission = z.infer<typeof CodeSubmissionSchema>;
export type VerificationEvent = z.infer<typeof VerificationEventSchema>;
export type CallbackEnvelope = z.infer<typeof CallbackEnvelopeSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type InteractionSummary = z.infer<typeof InteractionSummarySchema>;
export type DemoVerificationRequest = z.infer<typeof DemoVerificationRequestSchema>;
export type CallbackDeliverySummary = z.infer<typeof CallbackDeliverySummarySchema>;
export type CallbackDeliveriesResponse = z.infer<typeof CallbackDeliveriesResponseSchema>;
