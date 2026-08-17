import { z } from "zod";

import { createBotBlockerKeyRing } from "./botblocker-config.js";

const CanonicalBase64Schema = z
  .string()
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "Expected canonical base64",
  );
const BotBlockerKeyIdSchema = z.string().min(1).max(128);

const ProductionConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().startsWith("mongodb"),
  VALKEY_URL: z.string().startsWith("rediss://"),
  /**
   * Independent BotBlocker Ed25519 trust domain. The active private key is
   * PKCS#8 DER encoded as canonical base64. A previous key carries public
   * SPKI DER only and is accepted strictly before its overlap deadline.
   * All fields remain optional while BotBlocker is disabled.
   */
  BOTBLOCKER_ED25519_ACTIVE_KEY_ID: BotBlockerKeyIdSchema.optional(),
  BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64:
    CanonicalBase64Schema.optional(),
  BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: BotBlockerKeyIdSchema.optional(),
  BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64:
    CanonicalBase64Schema.optional(),
  BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  BOTBLOCKER_ED25519_REVOKED_KEY_IDS: z
    .string()
    .regex(/^[^,\s]+(?:,[^,\s]+)*$/)
    .optional(),
  BOTBLOCKER_CLOCK_SKEW_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(0),
  /**
   * Independent runtime-authentication domain. Site credentials are
   * server-only and are hashed with this secret before persistence. The
   * runtime origin is exact and HTTPS so requests cannot be replayed through
   * an unexpected host. Both remain optional while BotBlocker is inactive.
   */
  BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: z.string().min(32).optional(),
  /**
   * Dedicated HMAC domains for immutable project-scoped endpoint tokens and
   * 30-minute per-visitor authorization tokens. Neither secret is shared
   * with site credentials, API keys, callbacks, or signed decisions.
   */
  BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: z.string().min(32).optional(),
  BOTBLOCKER_VISITOR_TOKEN_SECRET: z.string().min(32).optional(),
  /**
   * Independent keyed-lookup domain for the pseudonymous BotBlocker browser
   * environment (fingerprint) hash. Caller-supplied fingerprint hashes are
   * never accepted. The trusted request IP is stored raw (not hashed) for
   * site-owner visitor reporting and return-visit correlation.
   */
  BOTBLOCKER_INTELLIGENCE_HASH_SECRET: z.string().min(32).optional(),
  BOTBLOCKER_RUNTIME_ORIGIN: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "BotBlocker runtime origin must use HTTPS",
    })
    .optional(),
  INTERACTION_TOKEN_SECRET: z.string().min(32),
  CONFIG_ENCRYPTION_KEY: z.string().min(32),
  SESSION_HASH_SECRET: z.string().min(32),
  API_KEY_HASH_SECRET: z.string().min(32),
  /**
   * A server-only "pepper" mixed into every customer password hash via
   * Argon2's own `secret` option (see `backend/packages/api/src/security.ts`) — never
   * stored in the database alongside the hash, unlike Argon2's per-hash
   * salt. Independent from every other secret; rotating it invalidates
   * every existing password hash (there are no real customer accounts yet,
   * so this is safe to set once now rather than added later as a breaking
   * migration).
   */
  PASSWORD_PEPPER: z.string().min(32),
  /**
   * SOC 2-oriented data protection for customer PII at rest: an account's
   * real email address is never stored as plaintext in `users.email` — it
   * is authenticated-encrypted (`backend/packages/api/src/security.ts#encryptString`,
   * same primitive as `ProjectDocument#callbackSecretEncrypted`) under
   * `PII_ENCRYPTION_KEY` into `emailEncrypted`, decrypted only transiently
   * when actually needed (sending a verification email, returning it to
   * the authenticated account itself in a session response). Independent
   * from every other secret, including `CONFIG_ENCRYPTION_KEY` (a
   * different security domain — provider/callback secrets, not customer
   * PII).
   */
  PII_ENCRYPTION_KEY: z.string().min(32),
  /**
   * A deterministic keyed hash of the same email address, stored alongside
   * `emailEncrypted` as `emailLookupHash` — the only way to find an account
   * by email (login, duplicate-registration checks) without ever storing
   * or querying against plaintext. Independent from `PII_ENCRYPTION_KEY`
   * (encryption and lookup-indexing are different concerns; a leak of one
   * secret alone should never compromise the other) and from every other
   * secret in this app.
   */
  EMAIL_LOOKUP_HASH_SECRET: z.string().min(32),
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
   * identical configuration (see `backend/packages/api/src/node-service.ts`), so one
   * shared value that is only ever edited in App Platform (never on a
   * node) is enough; a new droplet just needs `CONTROL_PLANE_URL` and
   * this same secret baked into its deployment, no admin action required.
   * Optional so the app starts fine before an operator sets it, in which
   * case node authentication always fails closed, the same convention as
   * `ADMIN_PASSWORD`.
   */
  NODE_SECRET: z.string().min(32).optional(),
  BREVO_API_KEY: z.string().min(1),
  /**
   * Optional Brevo transactional-email template id for the account
   * signup-verification message (see `backend/packages/api/src/email.ts`). Named after
   * what it is, not the provider, so it's unambiguous next to any future
   * per-customer branded template id. When unset, the verification email
   * falls back to a plain inline-HTML message (the original behavior) —
   * set this once the template has been created in the Brevo dashboard
   * using the HTML documented in `docs/AS_BUILT.md`'s "Customer signup
   * flow" section.
   */
  POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID: z.string().min(1).optional(),
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
   * telephony node (see `backend/packages/api/src/outbound-trunks.ts#allTrunkDids`
   * vs. `allOutboundTrunks`): nodes only need SIP credentials to dial
   * out, never the DID itself. `backend/packages/api/src/sms.ts` is the only
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
   * `backend/packages/api/src/challenge-service.ts`). All optional: the admin
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
  /**
   * Stripe fixed-amount ($5/$25/$50/$100) customer balance top-ups (see
   * `backend/packages/api/src/stripe-service.ts` and `docs/AS_BUILT.md`'s "Customer
   * balance billing" section). Both optional, same deferred-credential
   * convention as every other provider in this project: `POST
   * /v1/billing/topups` and the Stripe webhook route fail closed with
   * `billing_not_configured` until both are set. `STRIPE_WEBHOOK_SECRET` is
   * the signing secret for the specific webhook endpoint configured in the
   * Stripe dashboard to point at `POST /v1/billing/stripe/webhook`, not the
   * API secret key.
   */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /**
   * Optional external IP-reputation vendor behind BotBlocker's
   * `botblockerIpApiLookupsV4`/`V6` external vendor cache (Phase 16
   * network-intelligence design, "wait-for-full-result" branch — only
   * consulted when a resolved ASN type's `requiresApiLookup` is `true`).
   * Deliberately vendor-agnostic: `VENDOR_NAME` is a plain configured
   * label, not a hardcoded provider, since no specific vendor has been
   * chosen yet. All three optional, the same deferred-credential
   * convention as every other provider in this project — when any is
   * unset, the awaited vendor lookup is skipped entirely (never blocked
   * indefinitely) rather than failing closed with an error. See
   * `backend/packages/api/src/ip-reputation-client.ts`.
   */
  BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: z.string().min(1).optional(),
  BOTBLOCKER_IP_REPUTATION_VENDOR_URL: z.string().url().optional(),
  BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: z.string().min(1).optional(),
}).superRefine((configuration, context) => {
  const active = [
    configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID,
    configuration.BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64,
  ];
  const previous = [
    configuration.BOTBLOCKER_ED25519_PREVIOUS_KEY_ID,
    configuration.BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64,
    configuration.BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS,
  ];
  requireAllOrNone(active, "active BotBlocker key", context);
  requireAllOrNone(previous, "previous BotBlocker key", context);

  if (
    configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID &&
    configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID ===
      configuration.BOTBLOCKER_ED25519_PREVIOUS_KEY_ID
  ) {
    context.addIssue({
      code: "custom",
      message: "Active and previous BotBlocker key IDs must differ",
    });
  }
  const revoked = new Set(
    configuration.BOTBLOCKER_ED25519_REVOKED_KEY_IDS?.split(",") ?? [],
  );
  if (
    configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID &&
    revoked.has(configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID)
  ) {
    context.addIssue({
      code: "custom",
      message: "The active BotBlocker key cannot be revoked",
    });
  }
});

function requireAllOrNone(
  values: readonly unknown[],
  label: string,
  context: z.RefinementCtx,
): void {
  const configured = values.filter((value) => value !== undefined).length;
  if (configured !== 0 && configured !== values.length) {
    context.addIssue({
      code: "custom",
      message: `Every field for the ${label} must be configured together`,
    });
  }
}

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
  const configuration = ProductionConfigSchema.parse(sanitized);
  createBotBlockerKeyRing(configuration);
  return configuration;
}
