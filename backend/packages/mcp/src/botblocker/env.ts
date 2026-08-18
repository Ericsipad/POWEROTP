/**
 * Names only — never a value, an example secret, or a `.env` entry.
 *
 * Every BotBlocker adapter reads the same server-only names; none of these
 * may appear in browser code.
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
    name: "POWEROTP_WEBHOOK_ID",
    required: true,
    description:
      "Immutable self-validating endpoint identifier returned in the one-time project creation " +
      "setup response. Safe in server configuration and URLs; it routes requests but does not " +
      "replace the site credential or scoped visitor token.",
  },
  {
    name: "POWEROTP_SITE_CREDENTIAL",
    required: true,
    description:
      "Server-only site credential. Generate it (and rotate it any time) with " +
      "POST /v1/projects/{projectId}/botblocker/rotate-site-credential, which returns the raw " +
      "value exactly once. Used by the adapter to authenticate server-to-server and request a " +
      "scoped visitor session token; never resent afterward, never sent to a browser, and " +
      "never logged.",
  },
  {
    name: "POWEROTP_AUDIENCE",
    required: true,
    description:
      "Canonical HTTPS origin of your application (for example, https://your-app.example). " +
      "Binds signed browser/session material to that origin.",
  },
  {
    name: "POWEROTP_WEBHOOK_SIGNING_SECRET",
    required: true,
    description:
      "Project-specific 256-bit callback secret returned exactly once in the atomic project " +
      "creation setup response and stored encrypted by PowerOTP. Verifies the signed timestamp " +
      "and body of POWEROTP project callbacks, including challenge-status and planned BotBlocker " +
      "session-data-ready notifications, using " +
      "the same powerotp-signature: t=<unix-ms>,v1=<base64url HMAC-SHA256 of `${t}.${rawBody}`> " +
      "header scheme as other PowerOTP callbacks. Verify the signature and a recent timestamp " +
      "(5 minute window) before trusting a callback. A data-ready callback only prompts an " +
      "authoritative pull with that visitor session's scoped token.",
  },
];

/**
 * Enables the returning-visitor instant-allow cookie: a visitor who already received an
 * `allow` gets it again instantly from a signed, long-lived cookie, checked entirely on your
 * server without a fresh decision. Obtain this key pair for your site from PowerOTP.
 */
export const BOTBLOCKER_VERIFICATION_KEY_ENV_VARS: readonly PowerOtpEnvVar[] = [
  {
    name: "POWEROTP_VERIFICATION_KEY_ID",
    required: true,
    description: "Identifier for your site's active verification key (verificationKeys.active.keyId).",
  },
  {
    name: "POWEROTP_VERIFICATION_PUBLIC_KEY_SPKI_BASE64",
    required: true,
    description:
      "Canonical base64 SPKI DER of your site's active Ed25519 public key " +
      "(verificationKeys.active.publicKey), imported with " +
      'createPublicKey({ key, format: "der", type: "spki" }).',
  },
];

export function allBotBlockerEnvVarNames(): string[] {
  return [
    ...BOTBLOCKER_ENV_VARS.map((entry) => entry.name),
    ...BOTBLOCKER_VERIFICATION_KEY_ENV_VARS.map((entry) => entry.name),
  ];
}
