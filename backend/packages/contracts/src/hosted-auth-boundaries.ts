import { z } from "zod";

/**
 * Phase P0-S1 boundaries for POWEROTP Sign-In as a Service.
 *
 * These contracts name products and trust boundaries only. Identifier, persistence,
 * request-state, and provider contracts belong to later implementation steps.
 */

export const hostedAuthIdentityDataModes = [
  "powerotp_pii",
  "didit_pii",
] as const;
export const HostedAuthIdentityDataModeSchema = z.enum(
  hostedAuthIdentityDataModes,
);

const PowerOtpPiiRealmSchema = z
  .object({
    identityDataMode: z.literal("powerotp_pii"),
    origin: z.literal("https://authx.powerotp.com"),
    rpId: z.literal("authx.powerotp.com"),
  })
  .strict();

const DiditPiiRealmSchema = z
  .object({
    identityDataMode: z.literal("didit_pii"),
    origin: z.literal("https://authz.powerotp.com"),
    rpId: z.literal("authz.powerotp.com"),
  })
  .strict();

/**
 * A custody mode selects exactly one WebAuthn realm. Cross-realm origin/RP
 * combinations are rejected rather than normalized.
 */
export const HostedAuthRealmSchema = z.discriminatedUnion("identityDataMode", [
  PowerOtpPiiRealmSchema,
  DiditPiiRealmSchema,
]);

export const hostedAuthRealms = {
  powerotp_pii: {
    identityDataMode: "powerotp_pii",
    origin: "https://authx.powerotp.com",
    rpId: "authx.powerotp.com",
  },
  didit_pii: {
    identityDataMode: "didit_pii",
    origin: "https://authz.powerotp.com",
    rpId: "authz.powerotp.com",
  },
} as const;

/**
 * One private person root may own one profile in either realm or one profile in
 * each realm. Profiles cannot be duplicated, and passkeys, user handles, cookies,
 * and RP ceremonies remain profile-scoped.
 */
export const HostedAuthPersonProfileModelSchema = z
  .object({
    personRoot: z.literal("private_hosted_person"),
    profiles: z.array(HostedAuthRealmSchema).min(1).max(2),
    profileIsolation: z
      .object({
        passkeys: z.literal("realm_profile"),
        userHandles: z.literal("realm_profile"),
        cookies: z.literal("realm_profile"),
      })
      .strict(),
  })
  .strict()
  .superRefine((model, context) => {
    const modes = model.profiles.map((profile) => profile.identityDataMode);
    if (new Set(modes).size !== modes.length) {
      context.addIssue({
        code: "custom",
        message: "A person root can have at most one profile per identity data mode",
        path: ["profiles"],
      });
    }
  });

/**
 * Machine-readable product boundary manifest. Literal fields make accidental
 * Passport/BotBlocker coupling, cross-client SSO, or global client identity
 * exposure fail validation.
 */
export const HostedAuthProductBoundarySchema = z
  .object({
    product: z.literal("powerotp_hosted_auth"),
    services: z.tuple([z.literal("signup"), z.literal("signin")]),
    clientIdentityScope: z.literal("project"),
    clientIdentityField: z.literal("projectUserId"),
    freshProofPerClientRequest: z.literal(true),
    crossClientSso: z.literal(false),
    passportRelationship: z.literal("separate_future_optional_link"),
    botBlockerRelationship: z.literal("separate_service"),
  })
  .strict();

export const hostedAuthProductBoundary = {
  product: "powerotp_hosted_auth",
  services: ["signup", "signin"],
  clientIdentityScope: "project",
  clientIdentityField: "projectUserId",
  freshProofPerClientRequest: true,
  crossClientSso: false,
  passportRelationship: "separate_future_optional_link",
  botBlockerRelationship: "separate_service",
} as const;

HostedAuthProductBoundarySchema.parse(hostedAuthProductBoundary);
Object.values(hostedAuthRealms).forEach((realm) => {
  HostedAuthRealmSchema.parse(realm);
});

export type HostedAuthIdentityDataMode = z.infer<
  typeof HostedAuthIdentityDataModeSchema
>;
export type HostedAuthRealm = z.infer<typeof HostedAuthRealmSchema>;
export type HostedAuthPersonProfileModel = z.infer<
  typeof HostedAuthPersonProfileModelSchema
>;
export type HostedAuthProductBoundary = z.infer<
  typeof HostedAuthProductBoundarySchema
>;
