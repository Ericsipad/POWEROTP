# POWEROTP

POWEROTP is a production phone-verification control plane for call reachability,
five-digit voice codes, recording challenges, and SMS codes.

## Repository

- `apps/web` — Next.js landing page and account UI (code lives here; embedded and served
  by `apps/api`'s process in production, not deployed separately)
- `apps/api` — the single deployed process: Fastify public API and control plane, durable
  background processing, and the marketing/dashboard site and MCP guide embedded via
  `apps/api/src/server.ts`
- `apps/mcp` — anonymous read-only integration MCP server (embedded the same way; its own
  `npm run start` remains available for local development)
- `apps/telephony-agent` — Phase 4 Asterisk droplet agent
- `libraries/contracts` — shared runtime schemas
- `libraries/sdk-js` — server-side TypeScript client foundation
- `libraries/widget-loader` — hosted-widget loader foundation
- `docs` — product plan, specification, threat model, and acceptance criteria

There is exactly one App Platform component. See
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

Phase 2 customer/admin setup and first-admin enrollment are documented in
[`docs/PHASE2_OPERATIONS.md`](docs/PHASE2_OPERATIONS.md).

## DigitalOcean

Connect App Platform to repository `Ericsipad/POWEROTP`, branch `main`, using source
directory `/`. The deployable specification is [`.do/app.yaml`](.do/app.yaml); setup and
required encrypted variables are documented in
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

## Commands

Requires Node.js 22.

```sh
npm ci
npm run verify
```

Production services validate their configuration at startup. Mock verification data and
fake transports are restricted to automated tests.
