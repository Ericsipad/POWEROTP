import { z } from "zod";

import { HostedAuthIdentityDataModeSchema } from "./hosted-auth-boundaries.js";

const HostedAuthDataClassSchema = z
  .object({
    dataClass: z.string().min(1),
    controller: z.enum(["powerotp", "client"]),
    custodian: z.enum([
      "powerotp_supabase",
      "powerotp_runtime_mongodb",
      "powerotp_retention_mongodb",
      "powerotp_project_content_stores",
      "powerotp_kms",
      "didit",
      "client_system",
    ]),
    modes: z.array(HostedAuthIdentityDataModeSchema).min(1).max(2),
    clientExposure: z.enum([
      "none",
      "project_user_id_only",
      "authorized_outcomes_only",
      "own_project_configuration_only",
    ]),
    retention: z.enum([
      "active_request_plus_three_minute_terminal_window",
      "account_lifecycle_plus_approved_period",
      "credential_lifecycle_plus_approved_period",
      "project_configuration_lifecycle_plus_approved_period",
      "approved_audit_period",
      "capability_policy_process_and_purge",
      "capability_policy_retained_face",
      "until_identity_crypto_shred",
      "key_rotation_and_destroy_policy",
      "client_defined",
    ]),
    deletionOwner: z.enum([
      "hosted_identity_service",
      "hosted_runtime_service",
      "hosted_audit_service",
      "hosted_security_audit_service",
      "hosted_project_service",
      "hosted_deletion_orchestrator",
      "didit_deletion_adapter",
      "kms_key_service",
      "client",
    ]),
  })
  .strict();

export const hostedAuthDataClasses = [
  {
    dataClass: "person_profile_metadata",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "account_lifecycle_plus_approved_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "contact_plaintext",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii"],
    clientExposure: "none",
    retention: "account_lifecycle_plus_approved_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "contact_provider_record",
    controller: "powerotp",
    custodian: "didit",
    modes: ["didit_pii"],
    clientExposure: "none",
    retention: "account_lifecycle_plus_approved_period",
    deletionOwner: "didit_deletion_adapter",
  },
  {
    dataClass: "contact_keyed_lookup",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "until_identity_crypto_shred",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "webauthn_public_credential",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "credential_lifecycle_plus_approved_period",
    deletionOwner: "hosted_identity_service",
  },
  {
    dataClass: "provider_identity_mapping",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "account_lifecycle_plus_approved_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "consent_evidence",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "approved_audit_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "verification_claim_and_minimal_evidence",
    controller: "powerotp",
    custodian: "powerotp_supabase",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "authorized_outcomes_only",
    retention: "approved_audit_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "provider_verification_media_process_and_purge",
    controller: "powerotp",
    custodian: "didit",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "capability_policy_process_and_purge",
    deletionOwner: "didit_deletion_adapter",
  },
  {
    dataClass: "provider_retained_face",
    controller: "powerotp",
    custodian: "didit",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "capability_policy_retained_face",
    deletionOwner: "didit_deletion_adapter",
  },
  {
    dataClass: "auth_request_runtime",
    controller: "powerotp",
    custodian: "powerotp_runtime_mongodb",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "authorized_outcomes_only",
    retention: "active_request_plus_three_minute_terminal_window",
    deletionOwner: "hosted_runtime_service",
  },
  {
    dataClass: "redacted_auth_request_audit",
    controller: "powerotp",
    custodian: "powerotp_retention_mongodb",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "approved_audit_period",
    deletionOwner: "hosted_audit_service",
  },
  {
    dataClass: "project_identity_binding",
    controller: "powerotp",
    custodian: "powerotp_retention_mongodb",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "project_user_id_only",
    retention: "account_lifecycle_plus_approved_period",
    deletionOwner: "hosted_deletion_orchestrator",
  },
  {
    dataClass: "wrapped_identity_key",
    controller: "powerotp",
    custodian: "powerotp_retention_mongodb",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "until_identity_crypto_shred",
    deletionOwner: "kms_key_service",
  },
  {
    dataClass: "key_authority_material",
    controller: "powerotp",
    custodian: "powerotp_kms",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "key_rotation_and_destroy_policy",
    deletionOwner: "kms_key_service",
  },
  {
    dataClass: "auth_page_configuration_and_assets",
    controller: "powerotp",
    custodian: "powerotp_project_content_stores",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "own_project_configuration_only",
    retention: "project_configuration_lifecycle_plus_approved_period",
    deletionOwner: "hosted_project_service",
  },
  {
    dataClass: "auth_security_event",
    controller: "powerotp",
    custodian: "powerotp_retention_mongodb",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "none",
    retention: "approved_audit_period",
    deletionOwner: "hosted_security_audit_service",
  },
  {
    dataClass: "client_local_account_mapping",
    controller: "client",
    custodian: "client_system",
    modes: ["powerotp_pii", "didit_pii"],
    clientExposure: "project_user_id_only",
    retention: "client_defined",
    deletionOwner: "client",
  },
] as const;

const canonicalByClass = new Map(
  hostedAuthDataClasses.map((entry) => [entry.dataClass, entry]),
);

export const HostedAuthDataClassificationSchema = z
  .array(HostedAuthDataClassSchema)
  .length(hostedAuthDataClasses.length)
  .superRefine((entries, context) => {
    const names = new Set(entries.map((entry) => entry.dataClass));
    if (names.size !== entries.length) {
      context.addIssue({
        code: "custom",
        message: "Hosted-auth data classes must be unique",
      });
    }

    entries.forEach((entry, index) => {
      const canonical = canonicalByClass.get(entry.dataClass);
      if (!canonical || JSON.stringify(entry) !== JSON.stringify(canonical)) {
        context.addIssue({
          code: "custom",
          message: "Hosted-auth data governance must match the canonical class",
          path: [index],
        });
      }
    });
  });

HostedAuthDataClassificationSchema.parse(hostedAuthDataClasses);

export type HostedAuthDataClass = z.infer<typeof HostedAuthDataClassSchema>;
