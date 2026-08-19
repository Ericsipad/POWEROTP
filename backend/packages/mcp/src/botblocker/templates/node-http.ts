import type { AdapterTemplate } from "../types.js";

const POWEROTP_SERVER_TS = `import { createPublicKey } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createPowerOtpRequestListener,
  type AdvisoryRequestState,
} from "@powerotp/gate-node";

export type PowerOtpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  state: AdvisoryRequestState,
) => void | Promise<void>;

/**
 * Wraps an existing raw Node request handler. \`state\` is advisory only —
 * this module never blocks, redirects, or rewrites the wrapped handler's
 * request or response. Your handler decides whether and how to use it.
 *
 * POWEROTP_SITE_ID/POWEROTP_WEBHOOK_ID identify your endpoint. Generate
 * the credential from POST /v1/projects/{projectId}/botblocker/
 * rotate-site-credential.
 *
 * verificationKeys verifies the signed, persistent site-return credential
 * bound to one user-intelligence row. It publishes immediate local access
 * while the active session starts; later updates may revoke access or
 * require OTP. Obtain the key pair for your site from PowerOTP.
 */
export function createPowerOtpListener(handle: PowerOtpHandler) {
  return createPowerOtpRequestListener({
    projectId: process.env.POWEROTP_PROJECT_ID!,
    siteId: process.env.POWEROTP_SITE_ID!,
    webhookId: process.env.POWEROTP_WEBHOOK_ID!,
    siteCredential: process.env.POWEROTP_SITE_CREDENTIAL!,
    callbackSigningSecret: process.env.POWEROTP_WEBHOOK_SIGNING_SECRET!,
    audience: process.env.POWEROTP_AUDIENCE ?? "https://your-app.example",
    verificationKeys: {
      active: {
        keyId: process.env.POWEROTP_VERIFICATION_KEY_ID!,
        publicKey: createPublicKey({
          key: Buffer.from(process.env.POWEROTP_VERIFICATION_PUBLIC_KEY_SPKI_BASE64!, "base64"),
          format: "der",
          type: "spki",
        }),
      },
    },
    decisionTimeoutMs: 200,
    handle,
  });
}
`;

const SERVER_ENTRY_TS = `import { createServer } from "node:http";

import { createPowerOtpListener } from "./powerotp.js";

/**
 * Ordering: wrap your existing request handler with
 * \`createPowerOtpListener\` before passing it to \`createServer\`. Do this at
 * the outermost layer, before any of your own routing.
 */
const server = createServer(
  createPowerOtpListener((request, response, state) => {
    // Your existing application handler goes here. \`state.advisory\`,
    // \`state.status\`, and \`state.recommendation\` are available for your
    // own code to read; POWEROTP does not act on them for you.
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  }),
);

server.listen(Number(process.env.PORT ?? 3000));
`;

const BROWSER_CLIENT_TS = `import { createGateBrowserCoordinator } from "@powerotp/gate-node/browser";

/**
 * Credential-free browser mount. Call this once per page. It never opens
 * the OTP iframe automatically — call \`openOtp()\` yourself only after you
 * choose to react to an \`otp_required\` snapshot.
 */
export async function mountPowerOtp() {
  const gate = await createGateBrowserCoordinator({
    window,
    document,
    sensorVersion: "your-app-v1",
  });
  gate.start();

  gate.subscribe(() => {
    const snapshot = gate.getSnapshot();
    // Your own code decides whether and how to use snapshot.recommendation.
  });

  return gate; // exposes getSnapshot(), subscribe(), and openOtp()
}
`;

export function buildNodeHttpTemplate(packageVersion: string): AdapterTemplate {
  return {
    adapter: "node-http",
    displayName: "Raw Node HTTP",
    packageName: "@powerotp/gate-node",
    packageVersion,
    files: [
      {
        path: "server/powerotp.ts",
        contents: POWEROTP_SERVER_TS,
        note: "Create first. No other file may import from @powerotp/gate-node directly.",
      },
      {
        path: "server/index.ts",
        contents: SERVER_ENTRY_TS,
        note:
          "Wrap your existing http.createServer handler with createPowerOtpListener at the " +
          "outermost layer, before your own request routing runs.",
      },
      {
        path: "public/powerotp-client.ts",
        contents: BROWSER_CLIENT_TS,
        note:
          "Bundle and load from every page you want observed. Contains no site credential or " +
          "verification key material.",
      },
    ],
    placementSteps: [
      "1. Add server/powerotp.ts.",
      "2. Wrap your existing raw Node request listener with createPowerOtpListener in your " +
        "server entry point, replacing the listener passed to http.createServer/createServer.",
      "3. Bundle public/powerotp-client.ts (or the equivalent inline logic) into pages you want " +
        "observed; call mountPowerOtp() once on page load.",
      "4. Copy POWEROTP_PROJECT_ID, POWEROTP_SITE_ID, POWEROTP_WEBHOOK_ID, and the show-once " +
        "POWEROTP_WEBHOOK_SIGNING_SECRET from the project creation response. Generate " +
        "POWEROTP_SITE_CREDENTIAL via POST /v1/projects/{projectId}/botblocker/" +
        "rotate-site-credential, then set all values and your verification key pair server-side; never in a browser " +
        "bundle. See get_botblocker_environment_variables for the full list and how to obtain " +
        "each value.",
    ],
    testCommands: [
      "node --test server/*.test.ts",
      "curl -i http://localhost:3000/.well-known/powerotp-agent",
    ],
    exclusions: [
      "/_powerotp and /_powerotp/*",
      "/.well-known/powerotp-agent",
      "/health, /healthz, /ready, /readyz, /live, /livez, /.well-known/health/*",
      "/_next/*, /assets/*, /static/*, /favicon.ico, /robots.txt, /sitemap.xml",
      "HTTP OPTIONS and WebSocket upgrade requests",
    ],
    knownLimitations: [
      "The default session store is process-local. Multi-instance deployments must inject a " +
        "shared, concurrency-safe GateSessionStore that preserves active OTP sessions.",
      "Client IP defaults to the direct socket address. A forwarded header is only trusted with " +
        "an explicit trustedProxy header/position/IP-list configuration.",
      "BotBlocker only sees requests that reach this Node process; a directly reachable origin " +
        "bypassing it is invisible to BotBlocker.",
      "Decisions publish fail-open (full access) state whenever a fresh decision cannot be " +
        "returned before decisionTimeoutMs elapses; this never overrides an active OTP challenge.",
      "An inactive site publishes offline/full-access state, suppresses ordinary visitor calls, " +
        "and performs at most one readiness retry per server-provided retry interval.",
    ],
    troubleshooting: [
      {
        symptom: "Every request reports status: \"unavailable\".",
        explanation:
          "Confirm POWEROTP_SITE_ID/POWEROTP_WEBHOOK_ID/POWEROTP_SITE_CREDENTIAL are set and that the process can " +
          "reach node:crypto's createPublicKey without throwing (canonical base64, SPKI DER, " +
          "Ed25519 key type) for the required verificationKeys field.",
      },
      {
        symptom: "The /_powerotp/* bridge returns 403.",
        explanation:
          "Bridge requests require the same-origin marker and a matching Origin/Sec-Fetch-Site " +
          "header; confirm the browser client and server share the same audience/origin.",
      },
      {
        symptom: "State never leaves status: \"checking\".",
        explanation:
          "This is normal while a decision is pending; once decisionTimeoutMs elapses it " +
          "becomes fail_open.",
      },
    ],
    upgradeInstructions: [
      "Bump @powerotp/gate-node in package.json to the version reported by this manifest.",
      "Re-request this manifest and diff server/powerotp.ts against your current file before " +
        "reapplying local customizations.",
      "Re-run your test suite and confirm /.well-known/powerotp-agent still returns protocolVersion: 1.",
    ],
  };
}
