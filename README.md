# POWEROTP

POWEROTP is a production phone-verification control plane for call reachability,
five-digit voice codes, recording challenges, and SMS codes.

## Repository

This repository contains two fully standalone Next.js deployment roots plus
non-deployed SDK/adapter packages. The frontend and backend have separate manifests,
lockfiles, dependencies, and build commands; neither reads outside its own directory.

- `frontend` — frontend-only marketing/dashboard/widget site for `powerotp.com`
- `backend/apps/server` — API-only Next.js service for `api.powerotp.com`; owns `/v1`, `/mcp`,
  `/health`, `/ready`, Mongo/Valkey connections, and durable workers
- `backend/packages/api` — library only (no server of its own): auth/project/verification services,
  persistence, security primitives, durable background queue workers. Imported by
  `backend/apps/server` via its package exports (e.g. `@powerotp/api/auth-service.js`)
- `backend/packages/mcp` — library only: builds the MCP server/transport, imported by
  `backend/apps/server/app/mcp/route.ts`. Its own `npm run start` remains available for local
  development of the MCP guide in isolation
- `apps/telephony-agent` — Phase 4 Asterisk droplet agent
- `backend/packages/contracts` — backend-owned runtime schemas
- `libraries/sdk-js` — server-side TypeScript client foundation
- `libraries/widget-loader` — hosted-widget loader foundation
- `docs` — product plan, specification, threat model, and acceptance criteria;
  [`docs/AS_BUILT.md`](docs/AS_BUILT.md) is the ground-truth log of what's actually
  deployed — read it first when starting a new session. The complete route, auth,
  consumer, and production-origin catalog is
  [`docs/API_ROUTE_INVENTORY.md`](docs/API_ROUTE_INVENTORY.md)

Browser requests from the frontend use `NEXT_PUBLIC_API_URL=https://api.powerotp.com`.
The backend uses `PUBLIC_API_URL=https://api.powerotp.com` when it emits API URLs and
`PUBLIC_APP_URL=https://powerotp.com` for modal, widget, email, and Stripe return UI.
Stripe sends webhooks directly to
`https://api.powerotp.com/v1/billing/stripe/webhook`.

There are separate frontend and backend App Platform components. See
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

Phase 2 customer/admin setup and first-admin enrollment are documented in
[`docs/PHASE2_OPERATIONS.md`](docs/PHASE2_OPERATIONS.md).

## DigitalOcean

Connect both App Platform apps to `Ericsipad/POWEROTP` on `main`. Use source directory
`frontend` for the website and `backend` for the API (DigitalOcean expects paths
relative to the repository root, without a leading slash); each runs `npm run build` and
`npm start` from its own package. No App Spec YAML is required. Setup details and
required environment variables are documented in
[`infrastructure/app-platform/README.md`](infrastructure/app-platform/README.md).

## Commands

Requires Node.js 22.

```sh
npm ci
npm run verify
```

Production services validate their configuration at startup. Mock verification data and
fake transports are restricted to automated tests.
