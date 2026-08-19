import { z } from "zod";

import {
  BotBlockerChallengeCompletionSchema,
} from "./botblocker-challenge.js";
import {
  PassportAssertionSchema,
  PaidTokenPassAssertionSchema,
  RiskEventSchema,
} from "./botblocker-proofs.js";
import {
  BehaviorReportSchema,
  BotBlockerProtocolVersionSchema,
  BrowserEvidenceSchema,
  RequestContextSchema,
  SiteCredentialSchema,
  SiteIdSchema,
} from "./botblocker.js";
import { InitialBrowserProofEvidenceSchema } from "./botblocker-browser.js";
import { FingerprintVectorSchema } from "./fingerprint.js";

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
    gateSessionId: OpaqueIdSchema,
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
  gateSessionId: typeof OpaqueIdSchema;
  audience: typeof AudienceSchema;
  nonce: typeof NonceSchema;
  issuedAt: z.ZodNumber;
  payload: T;
}> {
  return z
    .object({
      protocolVersion: BotBlockerProtocolVersionSchema,
      siteId: SiteIdSchema,
      gateSessionId: OpaqueIdSchema,
      audience: AudienceSchema,
      nonce: NonceSchema,
      issuedAt: z.number().int().positive(),
      payload,
    })
    .strict();
}

/**
 * One closed report body for first contact and every later update. Each
 * evidence category is optional and omitted when unavailable; authentication
 * is selected from `reportSequence` by the HTTP boundary, not by caller data.
 */
export const CanonicalReportPayloadSchema = z
  .object({
    request: RequestContextSchema.optional(),
    browserEvidence: BrowserEvidenceSchema.optional(),
    fingerprint: FingerprintVectorSchema.optional(),
    proofs: InitialBrowserProofEvidenceSchema.shape.proofs.optional(),
    behaviorReport: BehaviorReportSchema.optional(),
    riskSignals: z.array(RiskEventSchema).min(1).max(200).optional(),
  })
  .strict();
export const CanonicalReportRequestSchema = runtimeRequest(
  CanonicalReportPayloadSchema,
)
  .extend({
    reportSequence: z.number().int().min(-1),
  })
  .strict()
  .superRefine(
  (request, context) => {
    if (
      request.payload.request &&
      request.payload.request.siteId !== request.siteId
    ) {
      context.addIssue({
        code: "custom",
        message: "Request context siteId must match the authenticated envelope",
        path: ["payload", "request", "siteId"],
      });
    }
    const behavior = request.payload.behaviorReport;
    if (
      behavior &&
      (behavior.protocolVersion !== request.protocolVersion ||
        behavior.sequence.gateSessionId !== request.gateSessionId ||
        behavior.sequence.sequence !== request.reportSequence ||
        behavior.sequence.issuedAt !== request.issuedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Behavior report order and scope must match the canonical envelope",
        path: ["payload", "behaviorReport"],
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
export type CanonicalReportPayload = z.infer<typeof CanonicalReportPayloadSchema>;
export type CanonicalReportRequest = z.infer<typeof CanonicalReportRequestSchema>;
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
