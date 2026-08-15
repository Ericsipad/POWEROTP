# @powerotp/gate-next

Private Next.js 16 App Router wrapper for the shared POWEROTP BotBlocker protocol. It keeps
credentials and Node-only verification/session code on the server, returns
`NextResponse.next()` immediately, and keeps the pending decision alive with
`NextFetchEvent.waitUntil()`.

## Server configuration

Create `powerotp.server.ts`. Do not import this module from a Client Component.

```ts
import "server-only";
import { createPowerOtpNext } from "@powerotp/gate-next";

export const powerOtp = createPowerOtpNext({
  siteId: process.env.POWEROTP_SITE_ID!,
  siteCredential: process.env.POWEROTP_SITE_CREDENTIAL!,
  audience: "https://customer.example",
  verificationKeys,
  decisionTimeoutMs: 200,
  protect: ({ path }) => path.startsWith("/account") || path.startsWith("/api/private"),
});
```

Next.js does not expose a socket address on `NextRequest`. By default no forwarding header is
trusted and `clientIp` is omitted. If a deployment exposes an authenticated direct peer address,
provide it with `resolveDirectAddress`. Trust a forwarded address only with the shared
`trustedProxy` option naming the exact header, first/last position, explicit direct proxy IPs,
and preferably `expectedProxyCount`. Never use a wildcard or a request header as the
`resolveDirectAddress` result.

The default session store is process-local. Multi-instance/serverless production requires an
injected bounded, concurrency-safe shared `GateSessionStore` that preserves active OTP state.

## Native `proxy.ts`

The matcher must remain a literal because Next statically analyzes it. Next.js 16 Proxy is
always Node runtime; do not add an unsupported `runtime` export.

```ts
import type { NextFetchEvent, NextRequest } from "next/server";
import { powerOtp } from "./powerotp.server";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return powerOtp.proxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|_powerotp(?:/|$)|\\.well-known/powerotp-agent(?:/|$)|health(?:/|$)|healthz$|ready$|readyz$|live$|livez$|\\.well-known/health(?:/|$)|assets(?:/|$)|static(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|ttf|txt|webmanifest|webp|woff2?)$).*)",
  ],
};
```

Proxy runs after `next.config` headers/redirects and before App Router/filesystem routes. The
matcher keeps framework assets, health/infrastructure paths, and owned bridge/discovery routes
out of Proxy. The adapter independently excludes `OPTIONS` and never reads protected page,
API, Server Action, upload, or streaming bodies.

## App Router handlers

Create `app/%5Fpowerotp/[...path]/route.ts`. Next treats a literal `_powerotp` folder as a
private folder; the `%5F` filesystem escape is required for the public `/_powerotp/*` URL:

```ts
import type { NextRequest } from "next/server";
import { powerOtp } from "../../../powerotp.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => powerOtp.route(request);
export const POST = (request: NextRequest) => powerOtp.route(request);
export const HEAD = (request: NextRequest) => powerOtp.route(request);
```

Create `app/.well-known/powerotp-agent/route.ts` with the same `runtime` and `dynamic` exports,
and `GET`/`HEAD` delegating to `powerOtp.route`. Do not create `/powerotp/aisummary` or any
customer-hosted CleanDataPage. Optional discovery URLs must be POWEROTP-hosted HTTPS URLs.

## Root client gate and CSP

Render the credential-free component once in the root layout:

```tsx
import { PowerOtpNextGate } from "@powerotp/gate-next/react";

// Inside <body>, after application content:
<PowerOtpNextGate sensorVersion="powerotp-browser-v1" />;
```

It persists across App Router client navigations. The shared coordinator derives session ID,
sensor sequence, and restored OTP state only from `/_powerotp/session`; every decision is
verified by the same-origin server bridge. `postMessage` only triggers authoritative polling.

The page lock creates a POWEROTP-hosted iframe. Add that exact trusted origin to your existing
CSP `frame-src` directive (the exported `withPowerOtpFrameSource` helper can merge it). Preserve
all other customer CSP directives and configure the hosted challenge's `frame-ancestors`
separately on POWEROTP. Do not use `*`.

Mount the root gate explicitly because Proxy must not rewrite, buffer, or inject into streamed
or compressed App Router output. Restrict direct-origin access independently; an
application-layer adapter cannot protect traffic that bypasses the Next.js process.
