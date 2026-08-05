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
    "POST /projects/{projectSlug}/verifications with Idempotency-Key, type, and E.164 targetNumber.",
  accepted:
    "HTTP 202 means queued, not delivered. Store interactionId and follow statusUrl or signed callbacks.",
  response:
    "Submit a code or opaque challenge option IDs from your server, or use the scoped short-lived interaction token.",
  security:
    "Never expose project secrets in browser code, mobile bundles, URLs, logs, or AI prompts.",
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
      browserResponse: type === "voice_code" || type === "voice_challenge",
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
