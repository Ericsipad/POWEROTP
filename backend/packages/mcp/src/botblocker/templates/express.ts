import type { AdapterTemplate } from "../types.js";

const POWEROTP_SERVER_TS = `import { createPublicKey } from "node:crypto";

import { createPowerOtpBotBlocker } from "@powerotp/gate-express";

/**
 * POWEROTP_SITE_ID/POWEROTP_SITE_CREDENTIAL identify your project; generate
 * the credential from POST /v1/projects/{projectId}/botblocker/
 * rotate-site-credential.
 *
 * verificationKeys lets a returning visitor who already received an
 * \`allow\` get it again instantly from a signed, long-lived cookie, checked
 * entirely on this server without a fresh decision. Obtain the key pair
 * for your site from PowerOTP.
 */
export const powerOtp = createPowerOtpBotBlocker({
  siteId: process.env.POWEROTP_SITE_ID!,
  siteCredential: process.env.POWEROTP_SITE_CREDENTIAL!,
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
});
`;

const APP_TS = `import express from "express";

import { powerOtp } from "./powerotp.js";

const app = express();

/**
 * Ordering: mount the gate at the application root, before body parsers,
 * static files, SSR, and API routers. It owns /_powerotp/* JSON bodies and
 * /.well-known/powerotp-agent, and never consumes any other request body.
 */
app.use(powerOtp.middleware());
app.use(express.json());
app.use(express.static("dist/client"));
app.use("/api", apiRouter);
app.get("/{*path}", renderReactApplication);

app.listen(Number(process.env.PORT ?? 3000));

// req.powerOtp / res.locals.powerOtp hold the same AdvisoryRequestState as
// every other wrapper. Placeholders below stand in for your own app code.
declare const apiRouter: express.Router;
declare function renderReactApplication(
  request: express.Request,
  response: express.Response,
): void;
`;

const REACT_ROOT_TSX = `import { PowerOtpBrowserGate } from "@powerotp/gate-express/react";

/**
 * Mount once near your application root. It reports state and runs the
 * approved sensor; it never changes rendering or calls openOtp() itself.
 * For subscribe()/getSnapshot()/openOtp() access from your own components,
 * call createGateBrowserCoordinator from "@powerotp/gate-node/browser"
 * directly instead of (or alongside) this fire-and-forget helper.
 */
export function AppRoot({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PowerOtpBrowserGate sensorVersion="your-app-v1" />
      {children}
    </>
  );
}
`;

export function buildExpressTemplate(packageVersion: string): AdapterTemplate {
  return {
    adapter: "express",
    displayName: "Express",
    packageName: "@powerotp/gate-express",
    packageVersion,
    files: [
      {
        path: "server/powerotp.ts",
        contents: POWEROTP_SERVER_TS,
        note: "Create first, server-only.",
      },
      {
        path: "server/app.ts",
        contents: APP_TS,
        note:
          "Mount powerOtp.middleware() (or powerOtp.router()) before body parsers, static " +
          "files, and API/SSR routers. Mount either the middleware or the router, not both.",
      },
      {
        path: "client/app-root.tsx",
        contents: REACT_ROOT_TSX,
        note: "Mount near your React root. Adds no DOM of its own.",
      },
    ],
    placementSteps: [
      "1. Add server/powerotp.ts.",
      "2. Mount powerOtp.middleware() at the top of server/app.ts, before express.json(), " +
        "express.static(), and your API/SSR routers.",
      "3. Mount <PowerOtpBrowserGate /> near your React root, or call " +
        "createGateBrowserCoordinator directly if you need subscribe()/getSnapshot()/openOtp().",
      "4. Generate POWEROTP_SITE_CREDENTIAL via POST /v1/projects/{projectId}/botblocker/" +
        "rotate-site-credential, generate POWEROTP_WEBHOOK_SIGNING_SECRET, and set them plus " +
        "POWEROTP_SITE_ID and your verification key pair server-side. See " +
        "get_botblocker_environment_variables for the full list and how to obtain each value.",
    ],
    testCommands: [
      "node --import tsx --test \"server/**/*.test.ts\"",
      "curl -i http://localhost:3000/.well-known/powerotp-agent",
    ],
    exclusions: [
      "/_powerotp and /_powerotp/*",
      "/.well-known/powerotp-agent",
      "/health, /healthz, /ready, /readyz, /live, /livez, /.well-known/health/*",
      "/_next/*, /assets/*, /static/*, /favicon.ico, /robots.txt, /sitemap.xml",
      "HTTP OPTIONS and WebSocket upgrade requests (normal Node upgrade events bypass Express " +
        "entirely; upgrade-shaped requests that still reach the router pass through unchanged)",
    ],
    knownLimitations: [
      "The default session store is process-local; clustered/multi-instance deployments need an " +
        "injected shared GateSessionStore.",
      "Express trust proxy settings do not configure BotBlocker; use the shared trustedProxy " +
        "option and never trust all callers as a substitute.",
      "This application-layer middleware only observes requests reaching this Express process.",
      "Decisions publish fail-open (full access) state whenever a fresh decision cannot be " +
        "returned before decisionTimeoutMs elapses; this never overrides an active OTP challenge.",
    ],
    troubleshooting: [
      {
        symptom: "Uploads or streamed responses appear truncated or buffered.",
        explanation:
          "They should not be — the middleware never reads application JSON/multipart bodies " +
          "or buffers responses. If you see buffering, check for another middleware mounted " +
          "before powerOtp.middleware() that consumes the body first.",
      },
      {
        symptom: "WebSocket connections fail after adding the gate.",
        explanation:
          "Confirm the WebSocket server attaches to the raw http.Server's \"upgrade\" event " +
          "rather than routing through Express; the middleware explicitly passes upgrade-shaped " +
          "requests through.",
      },
      {
        symptom: "req.powerOtp is undefined in a route handler.",
        explanation:
          "Confirm powerOtp.middleware() (or .router()) is mounted before that route and that " +
          "no earlier middleware calls res.end()/res.json() before next() runs.",
      },
    ],
    upgradeInstructions: [
      "Bump @powerotp/gate-express in package.json to the version reported by this manifest.",
      "Re-request this manifest and diff server/powerotp.ts and server/app.ts against your " +
        "current files before reapplying local customizations.",
      "Re-run your Express test suite, including upload/stream/WebSocket coverage.",
    ],
  };
}
