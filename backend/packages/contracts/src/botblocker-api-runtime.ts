import { z } from "zod";

import {
  BotBlockerChallengeCompletionSchema,
} from "./botblocker-challenge.js";
import {
  PassportAssertionSchema,
  PaidTokenPassAssertionSchema,
  RiskEventBatchSchema,
} from "./botblocker-proofs.js";
import {
  BehaviorReportSchema,
  BotBlockerProtocolVersionSchema,
  RequestContextSchema,
  SiteCredentialSchema,
  SiteIdSchema,
} from "./botblocker.js";

const OpaqueIdSchema = z.string().min(16).max(128);
const AudienceSchema = z.string().min(1).max(2_048);
const NonceSchema = z.string().min(16).max(256);

/** Authentication is carried by the HTTP credential/token. This closed
 * envelope binds every runtime request to its protocol, site, audience,
 * nonce, and issuance time; it never accepts a caller signature. */
export const BotBlockerRuntimeRequestEnvelopeSchema = z
  .object({
    protocolVersion: BotBlockerProtocolVersionSchema,
    siteId: SiteIdSchema,
    audience: AudienceSchema,
    nonce: NonceSchema,
    issuedAt: z.number().int().positive(),
    payload: z.unknown(),
  })
  .strict();

function runtimeRequest<T extends z.ZodType>(
  payload: T,
): z.ZodObject<{
  protocolVersion: typeof BotBlockerProtocolVersionSchema;
  siteId: typeof SiteIdSchema;
  audience: typeof AudienceSchema;
  nonce: typeof NonceSchema;
  issuedAt: z.ZodNumber;
  payload: T;
}> {
  return z
    .object({
      protocolVersion: BotBlockerProtocolVersionSchema,
      siteId: SiteIdSchema,
      audience: AudienceSchema,
      nonce: NonceSchema,
      issuedAt: z.number().int().positive(),
      payload,
    })
    .strict();
}

export const RapidAuthPayloadSchema = z
  .object({ request: RequestContextSchema })
  .strict();
export const RapidAuthRequestSchema = runtimeRequest(RapidAuthPayloadSchema).superRefine(
  (request, context) => {
    if (request.payload.request.siteId !== request.siteId) {
      context.addIssue({
        code: "custom",
        message: "Request context siteId must match the authenticated envelope",
        path: ["payload", "request", "siteId"],
      });
    }
  },
);

export const BrowserAssessmentPayloadSchema = z
  .object({ report: BehaviorReportSchema })
  .strict();
export const BrowserAssessmentRequestSchema = runtimeRequest(
  BrowserAssessmentPayloadSchema,
).superRefine((request, context) => {
  if (request.payload.report.protocolVersion !== request.protocolVersion) {
    context.addIssue({
      code: "custom",
      message: "Behavior report protocolVersion must match the authenticated envelope",
      path: ["payload", "report", "protocolVersion"],
    });
  }
});

export const RiskEventsPayloadSchema = z
  .object({ batch: RiskEventBatchSchema })
  .strict();
export const RiskEventsRequestSchema = runtimeRequest(RiskEventsPayloadSchema).superRefine(
  (request, context) => {
    if (
      request.payload.batch.siteId !== request.siteId ||
      request.payload.batch.protocolVersion !== request.protocolVersion
    ) {
      context.addIssue({
        code: "custom",
        message: "Risk-event batch scope must match the authenticated envelope",
        path: ["payload", "batch"],
      });
    }
  },
);

export const CreateChallengePayloadSchema = z
  .object({ gateSessionId: OpaqueIdSchema })
  .strict();
export const CreateChallengeRequestSchema = runtimeRequest(CreateChallengePayloadSchema);

export const ReadChallengePayloadSchema = z
  .object({ challengeId: OpaqueIdSchema })
  .strict();
export const ReadChallengeRequestSchema = runtimeRequest(ReadChallengePayloadSchema);

export const CompleteChallengePayloadSchema = BotBlockerChallengeCompletionSchema;
export const CompleteChallengeRequestSchema = runtimeRequest(CompleteChallengePayloadSchema);

/** Ed25519 public key only. Private key material and caller-declared
 * ownership or registration success have no place on this request. */
export const PassportRegistrationPublicKeySchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/, "Expected unpadded base64url"),
  })
  .strict();
export const PassportRegistrationPayloadSchema = z
  .object({
    gateSessionId: OpaqueIdSchema,
    credentialId: OpaqueIdSchema,
    publicKey: PassportRegistrationPublicKeySchema,
  })
  .strict();
export const PassportRegistrationRequestSchema = runtimeRequest(
  PassportRegistrationPayloadSchema,
);

export const PassportAssertionPayloadSchema = PassportAssertionSchema;
export const PassportAssertionRequestSchema = runtimeRequest(
  PassportAssertionPayloadSchema,
).superRefine((request, context) => {
  if (
    request.payload.siteId !== request.siteId ||
    request.payload.audience !== request.audience
  ) {
    context.addIssue({
      code: "custom",
      message: "Passport assertion scope must match the authenticated envelope",
      path: ["payload"],
    });
  }
});
export const PaidTokenPassAssertionPayloadSchema = PaidTokenPassAssertionSchema;
export const PaidTokenPassAssertionRequestSchema = runtimeRequest(
  PaidTokenPassAssertionPayloadSchema,
).superRefine((request, context) => {
  if (
    request.payload.siteId !== request.siteId ||
    request.payload.audience !== request.audience
  ) {
    context.addIssue({
      code: "custom",
      message: "PaidTokenPass assertion scope must match the authenticated envelope",
      path: ["payload"],
    });
  }
});

/** Entitlement lookup consumes an existing pass assertion. The result is
 * server-derived; no entitlement, owner, quota, or success claim is accepted. */
export const AgentEntitlementPayloadSchema = z
  .object({
    gateSessionId: OpaqueIdSchema,
    paidTokenPass: PaidTokenPassAssertionSchema,
  })
  .strict();
export const AgentEntitlementRequestSchema = runtimeRequest(
  AgentEntitlementPayloadSchema,
).superRefine((request, context) => {
  if (
    request.payload.paidTokenPass.siteId !== request.siteId ||
    request.payload.paidTokenPass.audience !== request.audience
  ) {
    context.addIssue({
      code: "custom",
      message: "Agent entitlement proof scope must match the authenticated envelope",
      path: ["payload", "paidTokenPass"],
    });
  }
});

/** The site credential is shown once. The remaining fields are safe
 * customer-facing rotation metadata, not persisted credential authority. */
export const BotBlockerCredentialRotationResponseSchema = z
  .object({
    value: SiteCredentialSchema,
    prefix: z.string().min(1).max(32),
    lastFour: z.string().length(4),
    createdAt: z.string().datetime(),
  })
  .strict();

export type BotBlockerRuntimeRequestEnvelope = z.infer<
  typeof BotBlockerRuntimeRequestEnvelopeSchema
>;
export type RapidAuthRequest = z.infer<typeof RapidAuthRequestSchema>;
export type BrowserAssessmentRequest = z.infer<typeof BrowserAssessmentRequestSchema>;
export type RiskEventsRequest = z.infer<typeof RiskEventsRequestSchema>;
export type CreateChallengeRequest = z.infer<typeof CreateChallengeRequestSchema>;
export type ReadChallengeRequest = z.infer<typeof ReadChallengeRequestSchema>;
export type CompleteChallengeRequest = z.infer<typeof CompleteChallengeRequestSchema>;
export type PassportRegistrationRequest = z.infer<
  typeof PassportRegistrationRequestSchema
>;
export type PassportAssertionRequest = z.infer<typeof PassportAssertionRequestSchema>;
export type PaidTokenPassAssertionRequest = z.infer<
  typeof PaidTokenPassAssertionRequestSchema
>;
export type AgentEntitlementRequest = z.infer<typeof AgentEntitlementRequestSchema>;
export type BotBlockerCredentialRotationResponse = z.infer<
  typeof BotBlockerCredentialRotationResponseSchema
>;
