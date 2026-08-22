import { z } from "zod";

/**
 * P1-S1 identifier contracts for POWEROTP hosted auth.
 *
 * POWEROTP-generated identifiers encode 256 random or keyed bits as canonical
 * unpadded base64url. A distinct prefix and Zod brand keep every purpose
 * separate at runtime and compile time. These schemas validate representation;
 * generators must use a CSPRNG (or the specified project-subject HMAC).
 */
const BASE64URL_256_BODY = "[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]";

const opaque256Schema = <Brand extends string>(
  prefix: string,
  purpose: string,
) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_${BASE64URL_256_BODY}$`),
      `Expected a canonical 256-bit ${purpose}`,
    )
    .brand<Brand>();

/** Private person-root identifier. Never exposed to a client. */
export const HostedPersonIdentityIdSchema = opaque256Schema<
  "HostedPersonIdentityId"
>("hpi", "hosted person identity ID");

/** Realm-specific authentication-profile identifier. Never exposed to a client. */
export const HostedAuthProfileIdSchema = opaque256Schema<"HostedAuthProfileId">(
  "hap",
  "hosted authentication profile ID",
);

/** Internal persisted project/person binding record identifier. */
export const ProjectIdentityBindingIdSchema =
  opaque256Schema<"ProjectIdentityBindingId">(
    "pib",
    "project identity binding ID",
  );

/** Immutable project resolver embedded in hosted signup and signin paths. */
export const ProjectIdentifierStringSchema =
  opaque256Schema<"ProjectIdentifierString">(
    "pai",
    "project authentication identifier",
  );

/**
 * Stable pairwise subject exposed only to its owning project. The value is the
 * canonical encoding of the versioned project/person keyed derivation.
 */
export const ProjectUserIdSchema = opaque256Schema<"ProjectUserId">(
  "pusr",
  "project user ID",
);

/** POWEROTP-generated permanent Didit `vendor_data` value. */
export const PotpDiditIdSchema = opaque256Schema<"PotpDiditId">(
  "pdi",
  "POWEROTP Didit ID",
);

/**
 * Didit's stable `didit_internal_id`. It is provider-owned, but remains
 * purpose-branded and accepts only a canonical random UUID (v4).
 */
export const DiditInternalIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Expected a canonical Didit v4 internal UUID",
  )
  .brand<"DiditInternalId">();

/** Public request correlation ID; possession does not authorize polling. */
export const HostedAuthRequestIdSchema = opaque256Schema<"HostedAuthRequestId">(
  "har",
  "hosted authentication request ID",
);

/**
 * Shown-once, server-only polling credential with at least 256 random bits.
 * Storage uses only its hash; this raw value must never enter browser state.
 */
export const HostedAuthPollTokenSchema =
  opaque256Schema<"HostedAuthPollToken">(
    "hpt",
    "hosted authentication poll token",
  );

export type HostedPersonIdentityId = z.infer<
  typeof HostedPersonIdentityIdSchema
>;
export type HostedAuthProfileId = z.infer<typeof HostedAuthProfileIdSchema>;
export type ProjectIdentityBindingId = z.infer<
  typeof ProjectIdentityBindingIdSchema
>;
export type ProjectIdentifierString = z.infer<
  typeof ProjectIdentifierStringSchema
>;
export type ProjectUserId = z.infer<typeof ProjectUserIdSchema>;
export type PotpDiditId = z.infer<typeof PotpDiditIdSchema>;
export type DiditInternalId = z.infer<typeof DiditInternalIdSchema>;
export type HostedAuthRequestId = z.infer<typeof HostedAuthRequestIdSchema>;
export type HostedAuthPollToken = z.infer<typeof HostedAuthPollTokenSchema>;
