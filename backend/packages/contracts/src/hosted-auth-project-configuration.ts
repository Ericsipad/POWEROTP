import { z } from "zod";

const uniqueValues = <T>(
  values: readonly T[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: "Methods must not contain duplicates",
      path,
    });
  }
};

export const HostedAuthReturnUrlSchema = z.string().trim().min(1).max(2_048);

export const HostedAuthReturnUrlsSchema = z
  .object({
    signupReturnUrl: HostedAuthReturnUrlSchema,
    signinReturnUrl: HostedAuthReturnUrlSchema,
    failureReturnUrl: HostedAuthReturnUrlSchema,
    recoveryReturnUrl: HostedAuthReturnUrlSchema,
    restartUrl: HostedAuthReturnUrlSchema,
  })
  .strict();

export const HostedAuthSignupContactMethodSchema = z.enum(["email", "phone"]);
export const HostedAuthSigninMethodSchema = z.enum([
  "passkey",
  "email",
  "phone",
  "biometric",
]);

export const HostedAuthMethodPolicySchema = z
  .object({
    signupContactMethods: z
      .array(HostedAuthSignupContactMethodSchema)
      .min(1)
      .max(2),
    signinMethods: z.array(HostedAuthSigninMethodSchema).min(1).max(4),
  })
  .strict()
  .superRefine((policy, context) => {
    uniqueValues(policy.signupContactMethods, context, ["signupContactMethods"]);
    uniqueValues(policy.signinMethods, context, ["signinMethods"]);
    if (!policy.signinMethods.includes("passkey")) {
      context.addIssue({
        code: "custom",
        message: "Passkey must remain an available sign-in method",
        path: ["signinMethods"],
      });
    }
  });

export const HostedAuthAssurancePolicySchema = z
  .object({
    minimumAge: z.number().int().min(1).max(120).nullable(),
    identityKycRequired: z.boolean(),
    livenessRequired: z.boolean(),
  })
  .strict();

export const HostedAuthBackendIpAllowlistSchema = z
  .array(z.string().trim().min(3).max(64))
  .max(100);

export const HostedAuthProjectSettingsSchema = z
  .object({
    signupEnabled: z.boolean(),
    signinEnabled: z.boolean(),
    methodPolicy: HostedAuthMethodPolicySchema,
    assurancePolicy: HostedAuthAssurancePolicySchema,
    backendIpAllowlist: HostedAuthBackendIpAllowlistSchema,
  })
  .strict();

export const UpdateHostedAuthProjectSettingsSchema =
  HostedAuthProjectSettingsSchema.partial()
    .strict()
    .refine(
      (value) => Object.keys(value).length > 0,
      "At least one field is required",
    );

export const DEFAULT_HOSTED_AUTH_PROJECT_SETTINGS = {
  signupEnabled: false,
  signinEnabled: false,
  methodPolicy: {
    signupContactMethods: ["email"],
    signinMethods: ["passkey", "email"],
  },
  assurancePolicy: {
    minimumAge: null,
    identityKycRequired: false,
    livenessRequired: false,
  },
  backendIpAllowlist: [],
} as const satisfies HostedAuthProjectSettings;

export type HostedAuthReturnUrls = z.infer<typeof HostedAuthReturnUrlsSchema>;
export type HostedAuthProjectSettings = z.infer<
  typeof HostedAuthProjectSettingsSchema
>;
export type UpdateHostedAuthProjectSettings = z.infer<
  typeof UpdateHostedAuthProjectSettingsSchema
>;
