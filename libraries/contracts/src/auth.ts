import { z } from "zod";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const PasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/\d/, "Password must include a number");

export const CustomerRegistrationSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

export const CustomerLoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export const AdminLoginSchema = CustomerLoginSchema.extend({
  totpCode: z.string().regex(/^\d{6}$/),
});

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

export const AdminBootstrapResponseSchema = z.object({
  user: SessionUserSchema,
  totpUri: z.string().startsWith("otpauth://"),
});

export type CustomerRegistration = z.infer<typeof CustomerRegistrationSchema>;
export type CustomerLogin = z.infer<typeof CustomerLoginSchema>;
export type AdminLogin = z.infer<typeof AdminLoginSchema>;
export type VerifyEmail = z.infer<typeof VerifyEmailSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
