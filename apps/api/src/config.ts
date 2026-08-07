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
  /**
   * A single shared secret every telephony droplet uses to authenticate
   * to `/v1/nodes/config`, entered once in App Platform — deliberately
   * not a per-node enrollment secret. Every droplet currently receives
   * identical configuration (see `apps/api/src/node-service.ts`), so one
   * shared value that is only ever edited in App Platform (never on a
   * node) is enough; a new droplet just needs `CONTROL_PLANE_URL` and
   * this same secret baked into its deployment, no admin action required.
   * Optional so the app starts fine before an operator sets it, in which
   * case node authentication always fails closed, the same convention as
   * `ADMIN_PASSWORD`.
   */
  NODE_SECRET: z.string().min(32).optional(),
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
   * VoIP.ms trunk credentials, one dedicated outbound per voice method so
   * a limit, suspension, or compromise on one method's trunk cannot affect
   * the others. See `outbound-trunks.ts` for the mapping.
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
  /**
   * VoIP.ms REST API credentials for `sms_code`. SMS is sent directly by
   * the control plane over HTTPS and never passes through Asterisk, so it
   * intentionally does not reuse the SIP-shaped OUTBOUND4_* variables.
   */
  VOIPMS_SMS_API_USERNAME: z.string().min(1).optional(),
  VOIPMS_SMS_API_PASSWORD: z.string().min(1).optional(),
  VOIPMS_SMS_DID: z.string().min(1).optional(),
  /**
   * Private DigitalOcean Spaces bucket holding `voice_challenge` (Type 3)
   * recordings, and the independent secret used to sign the manifest
   * telephony nodes verify before trusting a recording checksum (see
   * `apps/api/src/challenge-service.ts`). All optional: the admin
   * recording/challenge APIs and `voice_challenge` fail closed with
   * `method_not_available`/`no_published_challenges` until every one of
   * these is set, the same deferred-credential convention as the other
   * verification methods.
   */
  SPACES_ENDPOINT: z.string().url().optional(),
  SPACES_BUCKET: z.string().min(1).optional(),
  SPACES_ACCESS_KEY: z.string().min(1).optional(),
  SPACES_SECRET_KEY: z.string().min(1).optional(),
  MEDIA_MANIFEST_SECRET: z.string().min(32).optional(),
});

export type ProductionConfig = z.infer<typeof ProductionConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionConfig {
  // DigitalOcean App Platform (and most cloud consoles) let an operator
  // create an env var with an empty value rather than omitting it
  // entirely, which is indistinguishable from "set to an empty string" to
  // this process. Every optional field above requires a non-empty string
  // when present, so treating "" the same as unset here — instead of
  // letting it fail schema validation and crash the whole app at boot —
  // is what "optional" actually needs to mean in this deployment target.
  const sanitized = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== ""),
  );
  return ProductionConfigSchema.parse(sanitized);
}
