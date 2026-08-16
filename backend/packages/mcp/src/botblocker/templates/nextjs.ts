import type { AdapterTemplate } from "../types.js";

/**
 * Copied from `@powerotp/gate-next`'s exported `POWEROTP_PROXY_MATCHER` (see
 * `manifest.test.ts` for the drift check against that source of truth). Not
 * imported at runtime here so this documentation package never needs the
 * "next" peer as an actual runtime dependency.
 */
export const NEXTJS_PROXY_MATCHER_LITERAL =
  "/((?!_next/static|_next/image|_next/webpack-hmr|_powerotp(?:/|$)|\\.well-known/powerotp-agent(?:/|$)|health(?:/|$)|healthz$|ready$|readyz$|live$|livez$|\\.well-known/health(?:/|$)|assets(?:/|$)|static(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|ttf|txt|webmanifest|webp|woff2?)$).*)";

const POWEROTP_SERVER_TS = `import "server-only";

import { createPublicKey } from "node:crypto";

import { createPowerOtpNext } from "@powerotp/gate-next";

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
export const powerOtp = createPowerOtpNext({
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

const PROXY_TS = `import type { NextFetchEvent, NextRequest } from "next/server";

import { powerOtp } from "./powerotp.server";

/**
 * Next.js 16 Proxy is always Node runtime; do not add an unsupported
 * \`runtime\` export. Proxy runs after next.config headers/redirects and
 * before App Router/filesystem routes.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  return powerOtp.proxy(request, event);
}

/**
 * The matcher must stay a literal — Next statically analyzes config.matcher
 * and cannot resolve an imported constant here.
 */
export const config = {
  matcher: [
    ${JSON.stringify(NEXTJS_PROXY_MATCHER_LITERAL)},
  ],
};
`;

const LAYOUT_TSX = `import { PowerOtpNextProvider } from "@powerotp/gate-next/react";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { powerOtp } from "../powerotp.server";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestState = powerOtp.getRequestState(await headers());
  const initialSnapshot = requestState.advisory ? requestState.recommendation : undefined;

  return (
    <html lang="en">
      <body>
        <PowerOtpNextProvider sensorVersion="your-app-v1" initialSnapshot={initialSnapshot}>
          {children}
        </PowerOtpNextProvider>
      </body>
    </html>
  );
}
`;

const BRIDGE_ROUTE_TS = `import type { NextRequest } from "next/server";

import { powerOtp } from "../../../powerotp.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => powerOtp.route(request);
export const POST = (request: NextRequest) => powerOtp.route(request);
export const HEAD = (request: NextRequest) => powerOtp.route(request);
`;

const DISCOVERY_ROUTE_TS = `import type { NextRequest } from "next/server";

import { powerOtp } from "../../../powerotp.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => powerOtp.route(request);
export const HEAD = (request: NextRequest) => powerOtp.route(request);
`;

export function buildNextjsTemplate(packageVersion: string): AdapterTemplate {
  return {
    adapter: "nextjs",
    displayName: "Next.js (App Router)",
    packageName: "@powerotp/gate-next",
    packageVersion,
    files: [
      {
        path: "powerotp.server.ts",
        contents: POWEROTP_SERVER_TS,
        note:
          "Server-only (import \"server-only\" guards accidental client bundling; " +
          "npm install server-only). Never import this from a Client Component.",
      },
      {
        path: "proxy.ts",
        contents: PROXY_TS,
        note: "Repository root, next to next.config. The matcher array must stay a literal.",
      },
      {
        path: "app/layout.tsx",
        contents: LAYOUT_TSX,
        note: "Wrap existing root layout content with PowerOtpNextProvider; add no other markup.",
      },
      {
        path: "app/%5Fpowerotp/[...path]/route.ts",
        contents: BRIDGE_ROUTE_TS,
        note:
          "The %5F filesystem escape is required: Next treats a literal _powerotp folder as " +
          "private, but this produces the public /_powerotp/* URL.",
      },
      {
        path: "app/.well-known/powerotp-agent/route.ts",
        contents: DISCOVERY_ROUTE_TS,
        note: "Same runtime/dynamic exports as the bridge route.",
      },
    ],
    placementSteps: [
      "1. Add powerotp.server.ts.",
      "2. Add proxy.ts at the repository root with the literal matcher shown above.",
      "3. Add both App Router route files at their exact paths.",
      "4. Wrap app/layout.tsx's existing content with PowerOtpNextProvider.",
      "5. Generate POWEROTP_SITE_CREDENTIAL via POST /v1/projects/{projectId}/botblocker/" +
        "rotate-site-credential, generate POWEROTP_WEBHOOK_SIGNING_SECRET, and set them plus " +
        "POWEROTP_SITE_ID and your verification key pair server-side. See " +
        "get_botblocker_environment_variables for the full list and how to obtain each value.",
    ],
    testCommands: [
      "npm run build",
      "npm run test -w <your-app>",
      "curl -i http://localhost:3000/.well-known/powerotp-agent",
    ],
    exclusions: [
      "/_next/static, /_next/image, /_next/webpack-hmr",
      "/_powerotp and /_powerotp/*",
      "/.well-known/powerotp-agent",
      "/health, /healthz, /ready, /readyz, /live, /livez, /.well-known/health/*",
      "/assets/*, /static/*, /favicon.ico, /robots.txt, /sitemap.xml",
      "Static asset extensions matched by the proxy config (css, js, images, fonts, etc.)",
      "HTTP OPTIONS and WebSocket upgrade requests",
    ],
    knownLimitations: [
      "NextRequest exposes no socket address, so clientIp is omitted unless the deployment " +
        "supplies an authenticated resolveDirectAddress function.",
      "The default session store is process-local; serverless/multi-instance production needs " +
        "an injected bounded, concurrency-safe shared GateSessionStore.",
      "Proxy cannot observe traffic that bypasses the Next.js process (e.g. a CDN serving " +
        "cached responses directly).",
      "Decisions publish fail-open (full access) state whenever a fresh decision cannot be " +
        "returned before decisionTimeoutMs elapses; this never overrides an active OTP challenge.",
    ],
    troubleshooting: [
      {
        symptom: "getRequestState() always returns status: \"unavailable\".",
        explanation:
          "Confirm proxy.ts's matcher is unmodified and literal, and that no other proxy/" +
          "middleware strips the internal x-powerotp-request-state header before it reaches " +
          "App Router code.",
      },
      {
        symptom: "usePowerOtp() throws or returns unavailable outside any provider.",
        explanation: "Confirm PowerOtpNextProvider wraps the component tree in app/layout.tsx.",
      },
      {
        symptom: "TypeScript cannot resolve \"server-only\".",
        explanation: "Run npm install server-only — it is a required, zero-dependency peer.",
      },
    ],
    upgradeInstructions: [
      "Bump @powerotp/gate-next in package.json to the version reported by this manifest.",
      "Re-request this manifest and diff proxy.ts's matcher literal against your current file; " +
        "a changed matcher must be copied verbatim, never partially merged.",
      "Re-run npm run build and your App Router test suite, including a client-bundle scan for " +
        "credential/token literals.",
    ],
  };
}
