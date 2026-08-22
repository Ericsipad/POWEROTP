import { z } from "zod";

import {
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
} from "./hosted-auth-ceremony-scopes.js";
import {
  DiditInternalIdSchema,
  HostedAuthRequestIdSchema,
  HostedPersonIdentityIdSchema,
  PotpDiditIdSchema,
} from "./hosted-auth-identifiers.js";

export const HostedAuthProviderOperationIdSchema = z
  .string()
  .min(16)
  .max(200)
  .brand<"HostedAuthProviderOperationId">();
export const HostedAuthProviderEvidenceReferenceSchema = z
  .string()
  .min(16)
  .max(200)
  .brand<"HostedAuthProviderEvidenceReference">();

const ContactOperationBaseSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthContactScopeSchema,
  })
  .strict();

export const HostedAuthEmailProviderSchema = z.enum([
  "powerotp_email",
  "didit_email",
]);
export const HostedAuthPhoneProviderSchema = z.enum([
  "powerotp_sms",
  "powerotp_voice",
  "didit_phone",
]);

const EmailDestinationSchema = z.string().trim().email().max(320);
const PhoneDestinationSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 phone number");

const enforceContactCustody = (
  value: {
    scope: z.infer<typeof HostedAuthContactScopeSchema>;
    provider: string;
  },
  context: z.RefinementCtx,
) => {
  const expectedPrefix =
    value.scope.realm.identityDataMode === "powerotp_pii"
      ? "powerotp_"
      : "didit_";
  if (!value.provider.startsWith(expectedPrefix)) {
    context.addIssue({
      code: "custom",
      message: "Contact provider does not match the immutable custody mode",
      path: ["provider"],
    });
  }
};

export const HostedAuthEmailChallengeRequestSchema =
  ContactOperationBaseSchema.extend({
    provider: HostedAuthEmailProviderSchema,
    destination: EmailDestinationSchema,
  }).superRefine(enforceContactCustody);

export const HostedAuthPhoneChallengeRequestSchema =
  ContactOperationBaseSchema.extend({
    provider: HostedAuthPhoneProviderSchema,
    destination: PhoneDestinationSchema,
  }).superRefine(enforceContactCustody);

export const HostedAuthContactChallengeStartedSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthContactScopeSchema,
    providerOperationId: HostedAuthProviderOperationIdSchema,
    status: z.literal("challenge_sent"),
  })
  .strict();

const contactProofFields = {
  providerOperationId: HostedAuthProviderOperationIdSchema,
  proof: z.string().min(1).max(256),
};

export const HostedAuthEmailProofRequestSchema =
  ContactOperationBaseSchema.extend({
    provider: HostedAuthEmailProviderSchema,
    destination: EmailDestinationSchema,
    ...contactProofFields,
  }).superRefine(enforceContactCustody);

export const HostedAuthPhoneProofRequestSchema =
  ContactOperationBaseSchema.extend({
    provider: HostedAuthPhoneProviderSchema,
    destination: PhoneDestinationSchema,
    ...contactProofFields,
  }).superRefine(enforceContactCustody);

export const HostedAuthContactProofResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      authRequestId: HostedAuthRequestIdSchema,
      scope: HostedAuthContactScopeSchema,
      providerOperationId: HostedAuthProviderOperationIdSchema,
      status: z.literal("verified"),
      minimalEvidenceReference: HostedAuthProviderEvidenceReferenceSchema,
    })
    .strict(),
  z
    .object({
      authRequestId: HostedAuthRequestIdSchema,
      scope: HostedAuthContactScopeSchema,
      providerOperationId: HostedAuthProviderOperationIdSchema,
      status: z.enum(["rejected", "declined", "retryable_failure"]),
    })
    .strict(),
]);

export interface HostedAuthEmailProvider {
  startChallenge(
    request: HostedAuthEmailChallengeRequest,
  ): Promise<HostedAuthContactChallengeStarted>;
  verifyProof(
    request: HostedAuthEmailProofRequest,
  ): Promise<HostedAuthContactProofResult>;
}

export interface HostedAuthPhoneProvider {
  startChallenge(
    request: HostedAuthPhoneChallengeRequest,
  ): Promise<HostedAuthContactChallengeStarted>;
  verifyProof(
    request: HostedAuthPhoneProofRequest,
  ): Promise<HostedAuthContactProofResult>;
}

export const HostedAuthDiditUserRequestSchema = z
  .object({
    hostedPersonIdentityId: HostedPersonIdentityIdSchema,
    potpDiditId: PotpDiditIdSchema,
  })
  .strict();

export const HostedAuthDiditUserResultSchema = z
  .object({
    potpDiditId: PotpDiditIdSchema,
    diditInternalId: DiditInternalIdSchema,
  })
  .strict();

export const HostedAuthDiditVerificationRequestSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthVerificationScopeSchema,
    potpDiditId: PotpDiditIdSchema,
    diditInternalId: DiditInternalIdSchema,
  })
  .strict();

export const HostedAuthDiditVerificationStartedSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthVerificationScopeSchema,
    providerOperationId: HostedAuthProviderOperationIdSchema,
    status: z.literal("provider_operation_pending"),
  })
  .strict();

export const HostedAuthDiditDecisionRequestSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthVerificationScopeSchema,
    providerOperationId: HostedAuthProviderOperationIdSchema,
  })
  .strict();

export const HostedAuthDiditDecisionSchema = z.discriminatedUnion("status", [
  z
    .object({
      authRequestId: HostedAuthRequestIdSchema,
      scope: HostedAuthVerificationScopeSchema,
      providerOperationId: HostedAuthProviderOperationIdSchema,
      status: z.enum(["satisfied", "not_satisfied", "indeterminate"]),
      minimalEvidenceReference: HostedAuthProviderEvidenceReferenceSchema,
    })
    .strict(),
  z
    .object({
      authRequestId: HostedAuthRequestIdSchema,
      scope: HostedAuthVerificationScopeSchema,
      providerOperationId: HostedAuthProviderOperationIdSchema,
      status: z.enum(["pending", "declined", "canceled", "retryable_failure"]),
    })
    .strict(),
]);

export interface HostedAuthDiditProvider {
  createOrResolveUser(
    request: HostedAuthDiditUserRequest,
  ): Promise<HostedAuthDiditUserResult>;
  startVerification(
    request: HostedAuthDiditVerificationRequest,
  ): Promise<HostedAuthDiditVerificationStarted>;
  getDecision(
    request: HostedAuthDiditDecisionRequest,
  ): Promise<HostedAuthDiditDecision>;
}

export type HostedAuthProviderOperationId = z.infer<
  typeof HostedAuthProviderOperationIdSchema
>;
export type HostedAuthEmailChallengeRequest = z.infer<
  typeof HostedAuthEmailChallengeRequestSchema
>;
export type HostedAuthPhoneChallengeRequest = z.infer<
  typeof HostedAuthPhoneChallengeRequestSchema
>;
export type HostedAuthContactChallengeStarted = z.infer<
  typeof HostedAuthContactChallengeStartedSchema
>;
export type HostedAuthEmailProofRequest = z.infer<
  typeof HostedAuthEmailProofRequestSchema
>;
export type HostedAuthPhoneProofRequest = z.infer<
  typeof HostedAuthPhoneProofRequestSchema
>;
export type HostedAuthContactProofResult = z.infer<
  typeof HostedAuthContactProofResultSchema
>;
export type HostedAuthDiditUserRequest = z.infer<
  typeof HostedAuthDiditUserRequestSchema
>;
export type HostedAuthDiditUserResult = z.infer<
  typeof HostedAuthDiditUserResultSchema
>;
export type HostedAuthDiditVerificationRequest = z.infer<
  typeof HostedAuthDiditVerificationRequestSchema
>;
export type HostedAuthDiditVerificationStarted = z.infer<
  typeof HostedAuthDiditVerificationStartedSchema
>;
export type HostedAuthDiditDecisionRequest = z.infer<
  typeof HostedAuthDiditDecisionRequestSchema
>;
export type HostedAuthDiditDecision = z.infer<
  typeof HostedAuthDiditDecisionSchema
>;
