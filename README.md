# POWEROTP

POWEROTP is a production phone-verification control plane for call reachability,
five-digit voice codes, recording challenges, and SMS codes.

## Repository

This is a normal Next.js app: `npm run build`, `npm start`, no custom server. The
customer/verification API, durable background workers, and the public MCP guide are
Next.js Route Handlers in `apps/web/app`, backed by library code from `apps/api`/`apps/mcp`.

- `apps/web` — the one deployed app: Next.js marketing/dashboard site, and every `/v1`
  and `/mcp` API route as a standard Route Handler (see `apps/web/app` and `apps/web/lib`)
- `apps/api` — library only (no server of its own): auth/project/verification services,
  persistence, security primitives, durable background queue workers. Imported by
  `apps/web` via its package exports (e.g. `@powerotp/api/auth-service.js`)
- `apps/mcp` — library only: builds the MCP server/transport, imported by
  `apps/web/app/mcp/route.ts`. Its own `npm run start` remains available for local
  development of the MCP guide in isolation
- `apps/telephony-agent` — Phase 4 Asterisk droplet agent
- `libraries/contracts` — shared runtime schemas
- `libraries/sdk-js` — server-side TypeScript client foundation
- `libraries/widget-loader` — hosted-widget loader foundation
- `docs` — product plan, specification, threat model, and acceptance criteria;
  [`docs/AS_BUILT.md`](docs/AS_BUILT.md) is the ground-truth log of what's actually
  deployed — read it first when starting a new session

There is exactly one App Platform component. See
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

Phase 2 customer/admin setup and first-admin enrollment are documented in
[`docs/PHASE2_OPERATIONS.md`](docs/PHASE2_OPERATIONS.md).

## DigitalOcean

Set up the same way as any other app: connect App Platform to repository
`Ericsipad/POWEROTP`, branch `main`, source directory `/`, and let it auto-detect the
Node.js build/run commands from `package.json`. No App Spec YAML to paste in. Setup
details and required environment variables are documented in
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

## Commands

Requires Node.js 22.

```sh
npm ci
npm run verify
```

Production services validate their configuration at startup. Mock verification data and
fake transports are restricted to automated tests.
