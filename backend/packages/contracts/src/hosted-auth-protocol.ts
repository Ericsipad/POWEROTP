import { z } from "zod";

import {
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
} from "./hosted-auth-ceremony-scopes.js";
import { HostedAuthMachineScopeSchema } from "./hosted-auth-state-machine-core.js";

export const HOSTED_AUTH_API_VERSION = "2026-08-21" as const;
export const HOSTED_AUTH_BROWSER_PROTOCOL_VERSION = 1 as const;

export const HostedAuthApiVersionSchema = z.literal(HOSTED_AUTH_API_VERSION);
export const HostedAuthBrowserProtocolVersionSchema = z.literal(
  HOSTED_AUTH_BROWSER_PROTOCOL_VERSION,
);

export const hostedAuthErrorCodes = [
  "invalid_request",
  "invalid_project",
  "service_disabled",
  "invalid_return_url",
  "request_expired",
  "request_canceled",
  "invalid_poll_token",
  "result_expired",
  "idempotency_conflict",
  "unsupported_version",
  "verification_required",
  "verification_declined",
  "signup_required",
  "insufficient_balance",
  "recovery_delay_active",
  "image_validation_failed",
  "template_row_conflict",
  "authentication_failed",
  "rate_limited",
] as const;
export const HostedAuthErrorCodeSchema = z.enum(hostedAuthErrorCodes);

const RetryAfterSecondsSchema = z.number().int().positive().max(86_400);

export const HostedAuthErrorResponseSchema = z
  .object({
    apiVersion: HostedAuthApiVersionSchema,
    error: z
      .object({
        code: HostedAuthErrorCodeSchema,
        correlationId: z.string().min(16).max(200),
        retryAfterSeconds: RetryAfterSecondsSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const permitsRetryAfter =
      response.error.code === "rate_limited" ||
      response.error.code === "recovery_delay_active";
    if (response.error.retryAfterSeconds !== undefined && !permitsRetryAfter) {
      context.addIssue({
        code: "custom",
        message: "This stable error does not permit retryAfterSeconds",
        path: ["error", "retryAfterSeconds"],
      });
    }
  });

export const hostedAuthFailureReasons = [
  "request_expired",
  "request_canceled",
  "verification_required",
  "verification_declined",
  "signup_required",
  "insufficient_balance",
  "recovery_delay_active",
  "authentication_failed",
] as const;
export const HostedAuthFailureReasonSchema = z.enum(hostedAuthFailureReasons);

export const HOSTED_AUTH_ACTIVE_TTL_SECONDS = 600 as const;
export const HOSTED_AUTH_RESULT_TTL_SECONDS = 180 as const;

const TimestampMillisecondsSchema = z.number().int().nonnegative();

export const HostedAuthActiveWindowSchema = z
  .object({
    createdAtMs: TimestampMillisecondsSchema,
    expiresAtMs: TimestampMillisecondsSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (
      window.expiresAtMs !==
      window.createdAtMs + HOSTED_AUTH_ACTIVE_TTL_SECONDS * 1_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Active expiry must equal creation plus ten minutes",
        path: ["expiresAtMs"],
      });
    }
  });

export const HostedAuthTerminalResultWindowSchema = z
  .object({
    completedAtMs: TimestampMillisecondsSchema,
    resultExpiresAtMs: TimestampMillisecondsSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (
      window.resultExpiresAtMs !==
      window.completedAtMs + HOSTED_AUTH_RESULT_TTL_SECONDS * 1_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Every terminal result must expire exactly three minutes later",
        path: ["resultExpiresAtMs"],
      });
    }
  });

export const isHostedAuthWindowActive = (
  nowMs: number,
  expiresAtMs: number,
): boolean => {
  TimestampMillisecondsSchema.parse(nowMs);
  TimestampMillisecondsSchema.parse(expiresAtMs);
  return nowMs < expiresAtMs;
};

export const HostedAuthIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, "Use visible ASCII without whitespace")
  .brand<"HostedAuthIdempotencyKey">();

export const HostedAuthRequestHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 request hash")
  .brand<"HostedAuthRequestHash">();

export const HostedAuthIdempotentOperationSchema = z.enum([
  "create_auth_request",
  "cancel_auth_request",
  "send_contact_challenge",
  "verify_contact_challenge",
  "start_provider_verification",
  "replace_auth_return_urls",
  "replace_selected_template",
  "replace_row_image",
]);

export const HostedAuthIdempotencyScopeSchema = z.union([
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
  HostedAuthMachineScopeSchema,
]);

export const HostedAuthIdempotencyClaimSchema = z
  .object({
    apiVersion: HostedAuthApiVersionSchema,
    key: HostedAuthIdempotencyKeySchema,
    operation: HostedAuthIdempotentOperationSchema,
    scope: HostedAuthIdempotencyScopeSchema,
    requestHash: HostedAuthRequestHashSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    const contactOperation =
      claim.operation === "send_contact_challenge" ||
      claim.operation === "verify_contact_challenge";
    const verificationOperation =
      claim.operation === "start_provider_verification";
    if (
      contactOperation &&
      !HostedAuthContactScopeSchema.safeParse(claim.scope).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Contact idempotency requires an exact contact provider purpose",
        path: ["scope"],
      });
    }
    if (
      verificationOperation &&
      !HostedAuthVerificationScopeSchema.safeParse(claim.scope).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification idempotency requires an exact provider purpose",
        path: ["scope"],
      });
    }
  });

export type HostedAuthIdempotencyDecision =
  | Readonly<{ outcome: "new" }>
  | Readonly<{ outcome: "replay" }>
  | Readonly<{ outcome: "conflict"; errorCode: "idempotency_conflict" }>;

export const decideHostedAuthIdempotency = (
  existing: z.infer<typeof HostedAuthIdempotencyClaimSchema> | undefined,
  attempted: z.infer<typeof HostedAuthIdempotencyClaimSchema>,
): HostedAuthIdempotencyDecision => {
  const next = HostedAuthIdempotencyClaimSchema.parse(attempted);
  if (!existing) return { outcome: "new" };
  const prior = HostedAuthIdempotencyClaimSchema.parse(existing);
  const sameScope =
    JSON.stringify(prior.scope) === JSON.stringify(next.scope) &&
    prior.apiVersion === next.apiVersion &&
    prior.operation === next.operation &&
    prior.key === next.key;
  return sameScope && prior.requestHash === next.requestHash
    ? { outcome: "replay" }
    : { outcome: "conflict", errorCode: "idempotency_conflict" };
};

export type HostedAuthErrorCode = z.infer<typeof HostedAuthErrorCodeSchema>;
export type HostedAuthFailureReason = z.infer<
  typeof HostedAuthFailureReasonSchema
>;
export type HostedAuthIdempotencyClaim = z.infer<
  typeof HostedAuthIdempotencyClaimSchema
>;
