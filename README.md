# POWEROTP

POWEROTP is a production phone-verification control plane for call reachability,
five-digit voice codes, recording challenges, and SMS codes.

## Repository

- `apps/web` — Next.js landing page and account UI
- `apps/api` — Fastify public/control-plane API
- `apps/mcp` — anonymous read-only integration MCP server
- `apps/worker` — background orchestration
- `apps/telephony-agent` — Phase 4 Asterisk droplet agent
- `packages/contracts` — shared runtime schemas
- `packages/sdk-js` — server-side TypeScript client foundation
- `packages/widget-loader` — hosted-widget loader foundation
- `docs` — product plan, specification, threat model, and acceptance criteria

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
