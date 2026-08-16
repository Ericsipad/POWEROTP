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
});
```

The adapter publishes advisory state for every customer application request. It does not block
or modify any request, response, route, or render. Owned bridge/discovery endpoints,
framework/static assets, health checks, `OPTIONS`, and WebSocket upgrades are fixed technical
exclusions; there is no selective-route callback.

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
out of Proxy. The adapter independently excludes `OPTIONS` and never reads application page,
API, Server Action, upload, or streaming bodies.

For server-owned App Router decisions, read the framework request state after Proxy:

```tsx
import { headers } from "next/headers";
import { powerOtp } from "../powerotp.server";

const state = powerOtp.getRequestState(await headers());
```

Proxy replaces any inbound POWEROTP state header before forwarding an authenticated, bounded
recommendation and gate-session identifier through Next.js request-header overrides. The
server-only adapter authenticates that internal value and does not add it to the browser response.
Missing, malformed, forged, or modified state produces a typed `unavailable`/`full_access`
snapshot; the customer still owns all SSR, route, API, and response behavior.

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

Wrap the root layout with the credential-free provider:

```tsx
import { PowerOtpNextProvider } from "@powerotp/gate-next/react";

<PowerOtpNextProvider sensorVersion="powerotp-browser-v1">
  {children}
</PowerOtpNextProvider>;
```

The provider and hook only report state. They do not hide customer content or act on a
recommendation:

```tsx
const { snapshot, openOtp } = usePowerOtp();

// Customer code decides whether and how to use snapshot.
// Customer code may explicitly call the argument-free openOtp() when it chooses.
```

The provider persists across App Router client navigations and publishes the shared
`getSnapshot`/`subscribe` state through React's external-store contract. `openOtp()` is
argument-free and does nothing until customer code invokes it for a verified OTP recommendation.
The provider and hook never suppress customer rendering and render no checking, access, OTP,
button, or other product screen themselves.
The shared coordinator derives session ID, sensor sequence, and restored OTP state only from
`/_powerotp/session`; every decision is verified by the same-origin server bridge. `postMessage`
only triggers authoritative polling. `PowerOtpNextGate` remains as a no-children compatibility
mount for applications that do not consume the hook.

The page lock creates a POWEROTP-hosted iframe. Add that exact trusted origin to your existing
CSP `frame-src` directive (the exported `withPowerOtpFrameSource` helper can merge it). Preserve
all other customer CSP directives and configure the hosted challenge's `frame-ancestors`
separately on POWEROTP. Do not use `*`.

Mount the root gate explicitly because Proxy must not rewrite, buffer, or inject into streamed
or compressed App Router output. Restrict direct-origin access independently; an
application-layer adapter cannot observe or publish state for traffic that bypasses the Next.js
process.
