import { z } from "zod";

/**
 * P0-S3 consent, vendor-activation, and public-claim boundaries for hosted auth.
 * Final legal copy and calendar retention periods remain counsel-approved inputs.
 */
export const hostedAuthConsentPurposes = [
  {
    purpose: "hosted_identity_and_authentication",
    modes: ["powerotp_pii", "didit_pii"],
    capability: "core_hosted_auth",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: true,
    retainedFace: false,
  },
  {
    purpose: "didit_contact_custody_and_authentication",
    modes: ["didit_pii"],
    capability: "didit_contact",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: true,
    retainedFace: false,
  },
  {
    purpose: "age_assurance",
    modes: ["powerotp_pii", "didit_pii"],
    capability: "didit_age",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: true,
    retainedFace: false,
  },
  {
    purpose: "identity_kyc_assurance",
    modes: ["powerotp_pii", "didit_pii"],
    capability: "didit_kyc",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: true,
    retainedFace: false,
  },
  {
    purpose: "liveness_and_face_enrollment",
    modes: ["powerotp_pii", "didit_pii"],
    capability: "didit_liveness",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: false,
    retainedFace: false,
  },
  {
    purpose: "fresh_biometric_authentication_with_retained_face",
    modes: ["powerotp_pii", "didit_pii"],
    capability: "didit_biometric_authentication",
    separateAffirmativeDecision: true,
    reusableAcrossProjects: false,
    retainedFace: true,
  },
] as const;

const HostedAuthConsentPurposeEntrySchema = z
  .object({
    purpose: z.string(),
    modes: z.array(z.enum(["powerotp_pii", "didit_pii"])),
    capability: z.string(),
    separateAffirmativeDecision: z.literal(true),
    reusableAcrossProjects: z.boolean(),
    retainedFace: z.boolean(),
  })
  .strict();

export const HostedAuthConsentPurposeSetSchema = z
  .array(HostedAuthConsentPurposeEntrySchema)
  .length(hostedAuthConsentPurposes.length)
  .superRefine((entries, context) => {
    entries.forEach((entry, index) => {
      const canonical = hostedAuthConsentPurposes[index];
      if (JSON.stringify(entry) !== JSON.stringify(canonical)) {
        context.addIssue({
          code: "custom",
          message: "Hosted-auth consent purposes must match the canonical set",
          path: [index],
        });
      }
    });
  });

export const hostedAuthConsentEvidenceRequirements = {
  exactTextVersion: true,
  policyVersion: true,
  purpose: true,
  providerDisclosure: true,
  locale: true,
  timestamp: true,
  affirmativeAction: true,
  withdrawalOrDeletionPath: true,
  bundledConsentAllowed: false,
  preselectedConsentAllowed: false,
  captureBeforeConsentAllowed: false,
} as const;

export const HostedAuthConsentEvidenceRequirementsSchema = z
  .object({
    exactTextVersion: z.literal(true),
    policyVersion: z.literal(true),
    purpose: z.literal(true),
    providerDisclosure: z.literal(true),
    locale: z.literal(true),
    timestamp: z.literal(true),
    affirmativeAction: z.literal(true),
    withdrawalOrDeletionPath: z.literal(true),
    bundledConsentAllowed: z.literal(false),
    preselectedConsentAllowed: z.literal(false),
    captureBeforeConsentAllowed: z.literal(false),
  })
  .strict();

export const hostedAuthDiditProductionGates = [
  "counsel_approved_controller_notice_and_capability_consent",
  "didit_named_before_provider_collection_or_biometric_capture",
  "contractual_reuse_and_competing_service_carve_out",
  "data_processing_and_subprocessor_terms_approved",
  "capability_specific_retention_configured_no_indefinite_default",
  "model_training_opt_out_confirmed_in_writing",
  "provider_deletion_and_reconciliation_validated",
  "vendor_exit_and_replacement_plan_approved",
] as const;

export const HostedAuthDiditProductionGateSchema = z.enum(
  hostedAuthDiditProductionGates,
);
export const HostedAuthDiditProductionGateSetSchema = z
  .array(HostedAuthDiditProductionGateSchema)
  .length(hostedAuthDiditProductionGates.length)
  .superRefine((gates, context) => {
    gates.forEach((gate, index) => {
      if (gate !== hostedAuthDiditProductionGates[index]) {
        context.addIssue({
          code: "custom",
          message: "Didit production gates must match the canonical set",
          path: [index],
        });
      }
    });
  });

export const hostedAuthApprovedCertificationWording = [
  "designed to align with ISO/IEC 27001 controls",
  "uses infrastructure providers whose applicable services are certified",
] as const;

export const hostedAuthProhibitedClaims = [
  "powerotp_is_iso_27001_certified",
  "powerotp_is_soc_2_compliant",
  "powerotp_is_hipaa_compliant",
  "vendor_certification_covers_powerotp",
  "hosted_auth_or_age_assurance_is_guaranteed",
  "project_scoped_or_keyed_data_is_anonymous",
  "clients_have_no_privacy_or_compliance_obligations",
  "biometrics_are_never_retained_when_retained_face_is_enabled",
  "didit_need_not_be_disclosed",
  "one_consent_covers_undisclosed_future_capabilities",
] as const;

export const HostedAuthProhibitedClaimSchema = z.enum(
  hostedAuthProhibitedClaims,
);
export const HostedAuthProhibitedClaimSetSchema = z
  .array(HostedAuthProhibitedClaimSchema)
  .length(hostedAuthProhibitedClaims.length)
  .superRefine((claims, context) => {
    claims.forEach((claim, index) => {
      if (claim !== hostedAuthProhibitedClaims[index]) {
        context.addIssue({
          code: "custom",
          message: "Hosted-auth prohibited claims must match the canonical set",
          path: [index],
        });
      }
    });
  });

HostedAuthConsentPurposeSetSchema.parse(hostedAuthConsentPurposes);
HostedAuthConsentEvidenceRequirementsSchema.parse(
  hostedAuthConsentEvidenceRequirements,
);
HostedAuthDiditProductionGateSetSchema.parse(hostedAuthDiditProductionGates);
HostedAuthProhibitedClaimSetSchema.parse(hostedAuthProhibitedClaims);

export type HostedAuthConsentPurpose = z.infer<
  typeof HostedAuthConsentPurposeEntrySchema
>;
export type HostedAuthConsentEvidenceRequirements = z.infer<
  typeof HostedAuthConsentEvidenceRequirementsSchema
>;
