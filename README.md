# POWEROTP

POWEROTP is a production phone-verification control plane for call reachability,
five-digit voice codes, recording challenges, and SMS codes.

## Repository

- `apps/web` — Next.js landing page and account UI
- `apps/api` — Fastify public API, control plane, and durable background processing
- `apps/mcp` — anonymous read-only integration MCP server
- `apps/telephony-agent` — Phase 4 Asterisk droplet agent
- `libraries/contracts` — shared runtime schemas
- `libraries/sdk-js` — server-side TypeScript client foundation
- `libraries/widget-loader` — hosted-widget loader foundation
- `docs` — product plan, specification, threat model, and acceptance criteria

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
