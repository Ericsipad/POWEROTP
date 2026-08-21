import { z } from "zod";

/**
 * P0-S2 custody, trust, and abuse boundaries for hosted auth. Data-class
 * ownership and retention are defined in hosted-auth-data-classes.ts.
 */
export const HostedAuthContactCustodySchema = z.discriminatedUnion(
  "identityDataMode",
  [
    z
      .object({
        identityDataMode: z.literal("powerotp_pii"),
        contactCustodian: z.literal("powerotp"),
        recoverableContactStore: z.literal("powerotp_supabase_encrypted"),
        contactAuthenticator: z.literal("powerotp_providers"),
        providerFallbackAcrossModes: z.literal(false),
      })
      .strict(),
    z
      .object({
        identityDataMode: z.literal("didit_pii"),
        contactCustodian: z.literal("didit"),
        recoverableContactStore: z.literal("didit_user_only"),
        contactAuthenticator: z.literal("didit"),
        providerFallbackAcrossModes: z.literal(false),
      })
      .strict(),
  ],
);

export const hostedAuthContactCustody = [
  {
    identityDataMode: "powerotp_pii",
    contactCustodian: "powerotp",
    recoverableContactStore: "powerotp_supabase_encrypted",
    contactAuthenticator: "powerotp_providers",
    providerFallbackAcrossModes: false,
  },
  {
    identityDataMode: "didit_pii",
    contactCustodian: "didit",
    recoverableContactStore: "didit_user_only",
    contactAuthenticator: "didit",
    providerFallbackAcrossModes: false,
  },
] as const;

export const HostedAuthTrustBoundarySchema = z
  .object({
    clientResult: z.literal("api_key_plus_poll_token"),
    browserAuthority: z.literal("realm_cookie_and_csrf_no_client_secrets"),
    crossProjectAccess: z.literal("deny"),
    crossRealmCredentialUse: z.literal("deny"),
    clientAuthorizedRecoveryOrReset: z.literal(false),
    databaseOnlyDecryption: z.literal(false),
    privilegedSupportCredentialMutation: z.literal(false),
    providerCallbacks: z.literal("signed_replay_protected_reconciled"),
  })
  .strict();

export const hostedAuthTrustBoundary = {
  clientResult: "api_key_plus_poll_token",
  browserAuthority: "realm_cookie_and_csrf_no_client_secrets",
  crossProjectAccess: "deny",
  crossRealmCredentialUse: "deny",
  clientAuthorizedRecoveryOrReset: false,
  databaseOnlyDecryption: false,
  privilegedSupportCredentialMutation: false,
  providerCallbacks: "signed_replay_protected_reconciled",
} as const;

export const hostedAuthAbuseCases = [
  "cross_project_access",
  "open_redirect",
  "cross_realm_credential_replay",
  "client_authorized_recovery_or_reset",
  "contact_enumeration_or_pumping",
  "poll_token_theft_or_replay",
  "provider_callback_forgery_or_replay",
  "database_only_compromise",
  "runtime_service_compromise",
  "privileged_support_abuse",
  "sensitive_log_leakage",
  "deletion_failure_or_provider_orphan",
] as const;

export const HostedAuthAbuseCaseSchema = z.enum(hostedAuthAbuseCases);
export const HostedAuthAbuseCaseSetSchema = z
  .array(HostedAuthAbuseCaseSchema)
  .length(hostedAuthAbuseCases.length)
  .superRefine((abuseCases, context) => {
    abuseCases.forEach((abuseCase, index) => {
      if (abuseCase !== hostedAuthAbuseCases[index]) {
        context.addIssue({
          code: "custom",
          message: "Hosted-auth abuse cases must match the canonical set",
          path: [index],
        });
      }
    });
  });

hostedAuthContactCustody.forEach((custody) => {
  HostedAuthContactCustodySchema.parse(custody);
});
HostedAuthTrustBoundarySchema.parse(hostedAuthTrustBoundary);
HostedAuthAbuseCaseSetSchema.parse(hostedAuthAbuseCases);

export type HostedAuthContactCustody = z.infer<
  typeof HostedAuthContactCustodySchema
>;
export type HostedAuthTrustBoundary = z.infer<
  typeof HostedAuthTrustBoundarySchema
>;
