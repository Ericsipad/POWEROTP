# @powerotp/gate-express

Express 5 middleware for the shared POWEROTP BotBlocker gate protocol.

## Ordering

Create the gate with server-only configuration and mount it at the application root
before body parsers, static files, SSR, APIs, and React handlers:

```ts
const gate = createPowerOtpBotBlocker({
  siteId: process.env.POWEROTP_SITE_ID!,
  siteCredential: process.env.POWEROTP_SITE_CREDENTIAL!,
  audience: "https://customer.example",
  verificationKeys,
});

app.use(gate.middleware());
app.use(express.json());
app.use(express.static("dist/client"));
app.use("/api", apiRouter);
app.get("/{*path}", renderReactApplication);
```

`gate.router()` is an equivalent root-mounted Express router for applications that
prefer router composition. Mount either the middleware or the router, not both.
The early mount is required because the gate owns `/_powerotp/*` JSON bodies and
`/.well-known/powerotp-agent`.

Use `PowerOtpBrowserGate` from `@powerotp/gate-express/react` in the React root.
It contains no site credential and obtains its sequence and restored OTP state from
the same-origin server bridge. It reports state and runs the approved sensor; it never
changes customer rendering or calls `openOtp()` automatically.

## Request behavior

- Application responses continue immediately. A pending, rejected, or throwing
  decision service does not delay or cancel customer work.
- Advisory state is attached to every customer application request. Health, infrastructure,
  framework-static, asset, discovery, bridge, `OPTIONS`, and WebSocket requests are fixed
  technical exclusions; there is no selective-route callback.
- Application JSON, multipart uploads, request streams, response streams, and
  compressed responses are passed through without body consumption or response
  rewriting. The React root helper supplies state and sensing without HTML injection.
- WebSocket upgrades receive no advisory state. Normal Node `upgrade` events bypass Express;
  upgrade-shaped requests that reach the router are explicitly passed through.
- Express error middleware remains authoritative for downstream errors. After headers
  are sent it must delegate or destroy the response rather than write a second body.

The default client address is the direct socket address. Forwarded headers are used
only when `trustedProxy` names an exact header, `first` or `last` position, and explicit
trusted proxy IP addresses. `expectedProxyCount` may additionally require an exact
forwarded chain length. Express `trust proxy` does not configure BotBlocker and must
never be set to trust all callers as a substitute.

Path/header limits apply before application routing. The body limit applies only to
same-origin `/_powerotp/*` JSON requests, so customer uploads and streams remain intact.
Errors and events contain no authorization values, cookies, query strings, bodies, or
customer content.

The default session store is process-local. Multi-process or multi-instance deployments
must inject a bounded shared `GateSessionStore` that preserves active OTP sessions.
CleanDataPage discovery may reference POWEROTP-hosted HTTPS metadata only; this package
does not create customer CleanDataPage routes.

This application-layer middleware can publish state only for requests that reach this Express process.
Deployments behind a CDN or load balancer must independently restrict direct-origin and
alternate-path access; BotBlocker cannot observe or publish state for traffic that bypasses the
application.
