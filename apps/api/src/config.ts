import { z } from "zod";

const ProductionConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().startsWith("mongodb"),
  VALKEY_URL: z.string().startsWith("rediss://"),
  INTERACTION_TOKEN_SECRET: z.string().min(32),
  CONFIG_ENCRYPTION_KEY: z.string().min(32),
  SESSION_HASH_SECRET: z.string().min(32),
  API_KEY_HASH_SECRET: z.string().min(32),
  /**
   * Platform admin identity lives entirely in environment variables, not
   * the database: a single email/password pair plus an IP allowlist,
   * instead of a registered account with TOTP. All optional so the app
   * starts fine before an operator configures admin access; until then
   * admin login simply always fails.
   */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  ADMIN_ALLOWED_IPS: z.string().min(1).optional(),
  BREVO_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),
  PUBLIC_APP_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),
  /**
   * Slug of the operator-owned project backing the public "try it now"
   * demo widget on the marketing site. The demo endpoints are disabled
   * (404) when unset, so no anonymous verification path exists until an
   * operator deliberately creates and configures a demo project.
   */
  DEMO_PROJECT_SLUG: z.string().min(3).max(48).optional(),
  /**
   * VoIP.ms trunk credentials, one dedicated outbound per verification
   * method so a limit, suspension, or compromise on one method's trunk
   * cannot affect the others. See `outbound-trunks.ts` for the mapping.
   * All optional: the API starts fine before Phase 4 telephony wiring.
   */
  OUTBOUND1_URL: z.string().min(1).optional(),
  OUTBOUND1_USER: z.string().min(1).optional(),
  OUTBOUND1_PASS: z.string().min(1).optional(),
  OUTBOUND2_URL: z.string().min(1).optional(),
  OUTBOUND2_USER: z.string().min(1).optional(),
  OUTBOUND2_PASS: z.string().min(1).optional(),
  OUTBOUND3_URL: z.string().min(1).optional(),
  OUTBOUND3_USER: z.string().min(1).optional(),
  OUTBOUND3_PASS: z.string().min(1).optional(),
  OUTBOUND4_URL: z.string().min(1).optional(),
  OUTBOUND4_USER: z.string().min(1).optional(),
  OUTBOUND4_PASS: z.string().min(1).optional(),
});

export type ProductionConfig = z.infer<typeof ProductionConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionConfig {
  return ProductionConfigSchema.parse(environment);
}
