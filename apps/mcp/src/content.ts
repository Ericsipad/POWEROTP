import {
  verificationStates,
  verificationTypes,
  type VerificationType,
} from "@powerotp/contracts";

export const integrationOverview = {
  apiBaseUrl: "https://powerotp.com/v1",
  authentication:
    "Send the project secret as Authorization: Bearer <secret> from your server only.",
  creation:
    "POST /v1/projects/{projectSlug}/verifications with Idempotency-Key, type, and E.164 targetNumber.",
  accepted:
    "HTTP 202 means queued, not delivered. Store interactionId and follow statusUrl or signed callbacks.",
  status:
    "GET /v1/verifications/{interactionId} with your project's Authorization: Bearer <secret> returns the current state, reasonCode, and (once awaiting_response) the challenge question/options for voice_challenge.",
  response:
    "POST /v1/verifications/{interactionId}/response with a code (voice_code/sms_code) or optionIds (voice_challenge), from your server with Authorization: Bearer <secret>, or from a browser with the scoped short-lived interaction token in the x-interaction-token header instead.",
  callbacks:
    "Every state change is also POSTed to your project's callbackUrl as { apiVersion, event: { eventId, interactionId, sequence, type, state, occurredAt, reasonCode } }, signed with header powerotp-signature: t=<unix-ms>,v1=<base64url HMAC-SHA256 of `${t}.${rawBody}` using your callback signing secret>. Verify the signature and a recent timestamp (5 minute window) before trusting a callback; never rely on it as your only source of truth without also checking statusUrl if in doubt. Retried independently of the interaction's own result.",
  hostedModal:
    "For the plain OTP use case (not the bot-blocker middleware), you don't have to build your own UI at all: POST /v1/projects/{projectSlug}/modal-sessions with your project secret (no targetNumber needed) to get back a modalUrl. Embed that URL in an iframe on your site — the end user types their own phone number directly into the POWEROTP-hosted, POWEROTP-branded modal, which drives the whole call/SMS/code/challenge flow itself. Your backend still gets the authoritative result the normal way, through the signed callback above; the modal's postMessage to the parent page (if you listen for it) is a same-page UX convenience only and must never be treated as authoritative.",
  security:
    "Never expose project secrets in browser code, mobile bundles, URLs, logs, or AI prompts. The hosted modal above exists specifically so a browser never needs one at all.",
} as const;

export const verificationGuides: Record<VerificationType, string> = {
  call_reachability:
    "Creates an outbound call and succeeds when the destination answers. This proves reachability only, not identity or ownership.",
  voice_code:
    "Calls the target and repeats a five-digit code. Submit the user-entered code through the response endpoint before expiration.",
  voice_challenge:
    "POWEROTP selects and plays a recording, then returns question text and opaque answer options. Render the options and submit selected IDs; the correct answer remains server-only.",
  sms_code:
    "Sends a five-digit SMS code through the configured provider and validates a one-time response through the shared lifecycle.",
};

export function getCapabilities() {
  return {
    verificationTypes,
    verificationStates,
    callbackSecurity: "Timestamped HMAC signature with unique event ID and sequence",
    mcpAccess: "Public read-only documentation; no project or verification access",
  };
}

export function buildExample(type: VerificationType, language: "curl" | "typescript") {
  const body = JSON.stringify(
    {
      type,
      targetNumber: "+15551234567",
      ...(type === "voice_code" ? { code: "12345" } : {}),
      browserResponse:
        type === "voice_code" || type === "sms_code" || type === "voice_challenge",
    },
    null,
    2,
  );

  if (language === "curl") {
    return `curl -X POST "https://powerotp.com/v1/projects/PROJECT_SLUG/verifications" \\
  -H "Authorization: Bearer $POWEROTP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data '${body}'`;
  }

  return `const response = await fetch(
  "https://powerotp.com/v1/projects/PROJECT_SLUG/verifications",
  {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.POWEROTP_API_KEY}\`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(${body}),
  },
);

if (response.status !== 202) throw new Error(await response.text());
const interaction = await response.json();`;
}

/**
 * Generates an example for the hosted verification modal flow (see
 * `integrationOverview.hostedModal` above) — deliberately a separate
 * function/tool from `buildExample` rather than an overload, since a modal
 * session doesn't take a `targetNumber`/`type` the way a direct
 * verification does; it only optionally narrows which methods the modal
 * offers.
 */
export function buildModalSessionExample(language: "curl" | "typescript") {
  if (language === "curl") {
    return `curl -X POST "https://powerotp.com/v1/projects/PROJECT_SLUG/modal-sessions" \\
  -H "Authorization: Bearer $POWEROTP_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data '{"allowedTypes": ["sms_code", "voice_code"]}'

# Response: { "sessionId": "...", "modalUrl": "https://powerotp.com/widget/...", "expiresAt": "..." }
# Embed modalUrl in an iframe on your site. The end user types their own
# phone number directly into that hosted page; you never handle it.`;
  }

  return `import { PowerOtpClient } from "@powerotp/server-sdk";

const client = new PowerOtpClient({
  apiKey: process.env.POWEROTP_API_KEY!,
  projectUrl: "https://powerotp.com/v1/projects/PROJECT_SLUG/verifications",
});

const session = await client.createModalSession(["sms_code", "voice_code"]);
// Render an iframe (or use @powerotp/widget-loader's mountPowerOtpWidget)
// pointed at session.modalUrl. Your backend still gets the authoritative
// result through your project's signed callback, exactly as normal.`;
}
