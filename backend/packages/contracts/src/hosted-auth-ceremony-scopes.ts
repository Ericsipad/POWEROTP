import { z } from "zod";

import { HostedAuthProfileIdSchema } from "./hosted-auth-identifiers.js";
import { HostedAuthMachineScopeSchema } from "./hosted-auth-state-machine-core.js";

export const HostedAuthWebAuthnPurposeSchema = z.enum([
  "signup_discovery",
  "signup_registration",
  "signin_authentication",
  "recovery_registration",
  "credential_management_registration",
]);

export const HostedAuthWebAuthnScopeSchema = HostedAuthMachineScopeSchema.extend({
  purpose: HostedAuthWebAuthnPurposeSchema,
}).superRefine((scope, context) => {
  const signupOnly =
    scope.purpose === "signup_discovery" ||
    scope.purpose === "signup_registration";
  const signinOnly =
    scope.purpose === "signin_authentication" ||
    scope.purpose === "recovery_registration";
  if ((signupOnly && scope.flow !== "signup") || (signinOnly && scope.flow !== "signin")) {
    context.addIssue({
      code: "custom",
      message: "WebAuthn purpose does not match the hosted-auth flow",
      path: ["purpose"],
    });
  }
});

export const HostedAuthContactPurposeSchema = z.enum([
  "signup_contact_enrollment",
  "signin_contact_authentication",
  "recovery_contact_proof",
  "cross_realm_link_contact_proof",
]);

export const HostedAuthContactScopeSchema = HostedAuthMachineScopeSchema.extend({
  providerPurpose: HostedAuthContactPurposeSchema,
}).superRefine((scope, context) => {
  const signupOnly =
    scope.providerPurpose === "signup_contact_enrollment" ||
    scope.providerPurpose === "cross_realm_link_contact_proof";
  const signinOnly =
    scope.providerPurpose === "signin_contact_authentication" ||
    scope.providerPurpose === "recovery_contact_proof";
  if ((signupOnly && scope.flow !== "signup") || (signinOnly && scope.flow !== "signin")) {
    context.addIssue({
      code: "custom",
      message: "Contact provider purpose does not match the hosted-auth flow",
      path: ["providerPurpose"],
    });
  }
});

export const HostedAuthRecoveryScopeSchema =
  HostedAuthMachineScopeSchema.extend({
    flow: z.literal("signin"),
  });

export const HostedAuthCredentialGrantActionSchema = z.enum([
  "add_credential",
  "name_credential",
  "revoke_credential",
]);

export const HostedAuthCredentialGrantAuthorizationSchema = z.enum([
  "fresh_authentication",
  "completed_recovery",
]);

export const HostedAuthCredentialGrantScopeSchema =
  HostedAuthMachineScopeSchema.extend({
    authProfileId: HostedAuthProfileIdSchema,
    grantScope: HostedAuthCredentialGrantActionSchema,
    authorizedBy: HostedAuthCredentialGrantAuthorizationSchema,
  });

export const HostedAuthVerificationPurposeSchema = z.enum([
  "age_assurance",
  "identity_kyc_assurance",
  "liveness_and_face_enrollment",
  "fresh_biometric_authentication",
  "recovery_proof",
]);

export const HostedAuthVerificationScopeSchema =
  HostedAuthMachineScopeSchema.extend({
    providerPurpose: HostedAuthVerificationPurposeSchema,
  }).superRefine((scope, context) => {
    if (
      (scope.providerPurpose === "fresh_biometric_authentication" ||
        scope.providerPurpose === "recovery_proof") &&
      scope.flow !== "signin"
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification provider purpose requires a signin flow",
        path: ["providerPurpose"],
      });
    }
  });

export type HostedAuthWebAuthnPurpose = z.infer<
  typeof HostedAuthWebAuthnPurposeSchema
>;
export type HostedAuthWebAuthnScope = z.infer<
  typeof HostedAuthWebAuthnScopeSchema
>;
export type HostedAuthContactPurpose = z.infer<
  typeof HostedAuthContactPurposeSchema
>;
export type HostedAuthContactScope = z.infer<
  typeof HostedAuthContactScopeSchema
>;
export type HostedAuthRecoveryScope = z.infer<
  typeof HostedAuthRecoveryScopeSchema
>;
export type HostedAuthCredentialGrantAction = z.infer<
  typeof HostedAuthCredentialGrantActionSchema
>;
export type HostedAuthCredentialGrantAuthorization = z.infer<
  typeof HostedAuthCredentialGrantAuthorizationSchema
>;
export type HostedAuthCredentialGrantScope = z.infer<
  typeof HostedAuthCredentialGrantScopeSchema
>;
export type HostedAuthVerificationPurpose = z.infer<
  typeof HostedAuthVerificationPurposeSchema
>;
export type HostedAuthVerificationScope = z.infer<
  typeof HostedAuthVerificationScopeSchema
>;
