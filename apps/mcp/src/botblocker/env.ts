/**
 * Names only — never a value, an example secret, or a `.env` entry.
 *
 * The intended customer-facing credential model is exactly two secrets, both
 * generated once per project and rotatable:
 *
 * 1. A site/project API key (`POWEROTP_SITE_CREDENTIAL`) the adapter uses to
 *    authenticate server-to-server and request a scoped visitor session
 *    token. `POST /v1/projects/{projectId}/botblocker/rotate-site-credential`
 *    already implements exactly this: it returns the raw value once
 *    (`potp_bb_*`), stores only a hash thereafter, and supports idempotent
 *    re-rotation (`apps/api/src/botblocker-site-credential-service.ts`).
 * 2. A webhook signing secret (`POWEROTP_WEBHOOK_SIGNING_SECRET`) the adapter
 *    uses to verify the signed `/_powerotp/webhooks/challenge-status`
 *    callback payload. This is specified in `POWEROTP_BOTBLOCKER_PLAN.md`
 *    ("OTP integration") but has no shipped rotation service or webhook
 *    receiver yet — see `BOTBLOCKER_PLANNED_ENV_VARS` below.
 *
 * The scoped visitor session token itself is never a customer-configured
 * environment variable: the adapter requests and holds it server-side using
 * the site credential, exactly as already implemented in gate-node's session
 * store.
 */
export interface PowerOtpEnvVar {
  name: string;
  required: boolean;
  description: string;
}

export const BOTBLOCKER_ENV_VARS: readonly PowerOtpEnvVar[] = [
  {
    name: "POWEROTP_SITE_ID",
    required: true,
    description:
      "Public site identifier. Safe to log or send to the browser, but identifies a site — " +
      "it authorizes nothing by itself.",
  },
  {
    name: "POWEROTP_SITE_CREDENTIAL",
    required: true,
    description:
      "Server-only project API key. Generated once per project (and re-rotatable any time) by " +
      'the already-shipped POST /v1/projects/{projectId}/botblocker/rotate-site-credential ' +
      "endpoint, which returns the raw value exactly once. Used by the adapter to authenticate " +
      "server-to-server and request a scoped visitor session token; never resent afterward, " +
      "never sent to a browser, and never logged.",
  },
];

/**
 * Specified in `POWEROTP_BOTBLOCKER_PLAN.md`'s "OTP integration" section but not yet backed by
 * a shipped rotation service or a `/_powerotp/webhooks/challenge-status` receiver in any adapter.
 * Documented now so an integration written today needs no later renaming, and so this catalog
 * never silently omits a planned secret the customer will eventually need to place.
 */
export const BOTBLOCKER_PLANNED_ENV_VARS: readonly PowerOtpEnvVar[] = [
  {
    name: "POWEROTP_WEBHOOK_SIGNING_SECRET",
    required: false,
    description:
      "Planned, not yet active. Will verify the signed body of the fixed " +
      "/_powerotp/webhooks/challenge-status callback (independent 256-bit secret, generated " +
      "once per project, shown once, rotatable with overlap). No shipped adapter reads this " +
      "yet because no adapter implements that callback route yet.",
  },
];

/**
 * `verificationKeys` (Ed25519 public key) lets a returning visitor who already received an
 * `allow` get it again instantly from a signed, long-lived cookie, checked entirely on the
 * customer's own server without a fresh decision or a PowerOTP round-trip (see
 * `libraries/gate-node/src/cookies.ts`). Today the constructor takes this value directly; Phase
 * 14A (`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`) resolves it automatically from the signed
 * policy release at `GET /v1/botblocker/policy/{siteId}` using only the public `siteId`, the
 * same way the "Signed Policy Client" section of `POWEROTP_BOTBLOCKER_PLAN.md` already
 * describes. Until Phase 14A ships, these two names are what the constructor needs directly.
 */
export const BOTBLOCKER_UNDELIVERED_ENV_VARS: readonly PowerOtpEnvVar[] = [
  {
    name: "POWEROTP_VERIFICATION_KEY_ID",
    required: true,
    description:
      "verificationKeys.active.keyId — powers the returning-visitor instant-allow cookie fast " +
      "path. Set this directly until Phase 14A automates key delivery from the signed policy " +
      "release.",
  },
  {
    name: "POWEROTP_VERIFICATION_PUBLIC_KEY_SPKI_BASE64",
    required: true,
    description:
      "verificationKeys.active.publicKey for the same fast path as POWEROTP_VERIFICATION_KEY_ID " +
      "above. Set this directly until Phase 14A automates key delivery.",
  },
];

export function allBotBlockerEnvVarNames(): string[] {
  return [
    ...BOTBLOCKER_ENV_VARS.map((entry) => entry.name),
    ...BOTBLOCKER_PLANNED_ENV_VARS.map((entry) => entry.name),
    ...BOTBLOCKER_UNDELIVERED_ENV_VARS.map((entry) => entry.name),
  ];
}
