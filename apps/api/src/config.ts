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
   * A flat, numbered, type-agnostic pool of VoIP.ms trunk credentials.
   * Any configured trunk can serve any of the three voice verification
   * methods (`call_reachability`, `voice_code`, `voice_challenge`) — the
   * telephony-agent rotates across whichever trunks are currently healthy
   * and fails over to the next one on a provider-level error (see
   * `apps/telephony-agent/src/trunk-pool.ts` and the "Outbound trunk
   * pool" section of `docs/AS_BUILT.md`). `TRUNK1..6` gives headroom
   * beyond the 3 numbers in use today without overengineering a
   * dynamic-key schema; raising the cap later (e.g. adding `TRUNK7_*`) is
   * a one-line change per trunk. All optional: the API starts fine before
   * any trunk is configured, and `outbound-trunks.ts#allOutboundTrunks`
   * skips any `TRUNKn` where url/user/pass aren't all present.
   */
  /**
   * `TRUNKn_DID` is that trunk's own phone number (the VoIP.ms DID whose
   * Caller ID/registration this trunk's SIP credentials belong to) —
   * optional and independent of url/user/pass. It is never sent to a
   * telephony node (see `apps/api/src/outbound-trunks.ts#allTrunkDids`
   * vs. `allOutboundTrunks`): nodes only need SIP credentials to dial
   * out, never the DID itself. `apps/api/src/sms.ts` is the only
   * consumer — it reuses whichever `TRUNKn_DID`s are set as the pool of
   * numbers `sms_code` can send from, instead of a separate single
   * `VOIPMS_SMS_DID` (every DID with SMS enabled can send, not just one).
   */
  TRUNK1_URL: z.string().min(1).optional(),
  TRUNK1_USER: z.string().min(1).optional(),
  TRUNK1_PASS: z.string().min(1).optional(),
  TRUNK1_DID: z.string().min(1).optional(),
  TRUNK2_URL: z.string().min(1).optional(),
  TRUNK2_USER: z.string().min(1).optional(),
  TRUNK2_PASS: z.string().min(1).optional(),
  TRUNK2_DID: z.string().min(1).optional(),
  TRUNK3_URL: z.string().min(1).optional(),
  TRUNK3_USER: z.string().min(1).optional(),
  TRUNK3_PASS: z.string().min(1).optional(),
  TRUNK3_DID: z.string().min(1).optional(),
  TRUNK4_URL: z.string().min(1).optional(),
  TRUNK4_USER: z.string().min(1).optional(),
  TRUNK4_PASS: z.string().min(1).optional(),
  TRUNK4_DID: z.string().min(1).optional(),
  TRUNK5_URL: z.string().min(1).optional(),
  TRUNK5_USER: z.string().min(1).optional(),
  TRUNK5_PASS: z.string().min(1).optional(),
  TRUNK5_DID: z.string().min(1).optional(),
  TRUNK6_URL: z.string().min(1).optional(),
  TRUNK6_USER: z.string().min(1).optional(),
  TRUNK6_PASS: z.string().min(1).optional(),
  TRUNK6_DID: z.string().min(1).optional(),
  /**
   * VoIP.ms REST API credentials for `sms_code`. SMS is sent directly by
   * the control plane over HTTPS and never passes through Asterisk, so
   * these are intentionally separate from the SIP-shaped `TRUNKn_URL/
   * USER/PASS` variables — but the sending DID pool itself is *not*
   * separate: see `TRUNKn_DID` above, which doubles as both "this
   * trunk's own number" and "an SMS-capable number sms_code can use".
   */
  VOIPMS_SMS_API_USERNAME: z.string().min(1).optional(),
  VOIPMS_SMS_API_PASSWORD: z.string().min(1).optional(),
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
