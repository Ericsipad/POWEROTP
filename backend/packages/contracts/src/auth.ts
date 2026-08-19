import { z } from "zod";

import { ReferralCodeSchema } from "./accounting.js";
import {
  BotBlockerProjectSetupSchema,
  ProjectSchema,
} from "./projects.js";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const PasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/\d/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

/**
 * The same rules as `PasswordSchema`, expressed as independently testable
 * predicates so the signup modal's live checklist UI
 * (`frontend/app/signup-modal.tsx`) and the server-side schema above can
 * never silently drift apart.
 */
export const PASSWORD_REQUIREMENTS: Array<{
  id: string;
  label: string;
  test: (password: string) => boolean;
}> = [
  { id: "length", label: "At least 12 characters", test: (password) => password.length >= 12 },
  { id: "uppercase", label: "One uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { id: "lowercase", label: "One lowercase letter", test: (password) => /[a-z]/.test(password) },
  { id: "digit", label: "One number", test: (password) => /\d/.test(password) },
  {
    id: "special",
    label: "One special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export const CustomerRegistrationSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

/**
 * The combined "rapid signup" flow (`POST /v1/auth/signup`): one submission
 * creates the account *and* a first project/API key together, shown once in
 * the same modal — see `docs/AS_BUILT.md`'s "Customer signup flow" section.
 * Website origins are configured later on the project and never gate account
 * creation.
 */
export const SignupSchema = CustomerRegistrationSchema.extend({
  referralCode: ReferralCodeSchema.optional(),
});

export const SignupResponseSchema = z.object({
  status: z.enum(["verification_email_queued", "already_registered"]),
  project: ProjectSchema.optional(),
  apiKey: z.string().optional(),
  botBlocker: BotBlockerProjectSetupSchema.optional(),
});

export const CustomerLoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export const AdminLoginSchema = CustomerLoginSchema;

export const VerifyEmailSchema = z.object({
  token: z.string().min(32).max(512),
});

export const SessionUserSchema = z.object({
  id: z.string().min(16),
  email: EmailSchema,
  accountClass: z.enum(["customer", "platform_admin"]),
  emailVerified: z.boolean(),
});

export const SessionResponseSchema = z.object({
  user: SessionUserSchema,
  csrfToken: z.string().min(32),
});

export type CustomerRegistration = z.infer<typeof CustomerRegistrationSchema>;
export type Signup = z.infer<typeof SignupSchema>;
export type SignupResponse = z.infer<typeof SignupResponseSchema>;
export type CustomerLogin = z.infer<typeof CustomerLoginSchema>;
export type AdminLogin = z.infer<typeof AdminLoginSchema>;
export type VerifyEmail = z.infer<typeof VerifyEmailSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
