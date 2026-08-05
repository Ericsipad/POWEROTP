# DigitalOcean App Platform connection

## Repository selection

- Repository: `Ericsipad/POWEROTP`
- Branch: `main`
- Source directory: `/`
- App specification: [`.do/app.yaml`](../../.do/app.yaml)

The source directory must be `/`, not a subfolder. This is an npm workspace monorepo and
the build needs the root lockfile plus shared contracts.

## One component

There is exactly **one** App Platform component, `app`. It runs a single Node process
(`apps/api/src/server.ts`) that serves:

- The marketing/dashboard site (Next.js, embedded via its programmatic server API)
- The customer and verification API under `/v1`, plus its durable background queue workers
- The public, read-only MCP integration guide under `/mcp`

There is no separate `web`/`api`/`mcp` service split and no ingress path-routing
configuration to keep in sync — Fastify handles `/health`, `/ready`, `/v1/*`, and `/mcp`
directly, and falls through to Next.js for every other path.

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

All variables are entered once as **app-level** environment variables in the App
Platform UI (App → Settings → App-Level Environment Variables) — there being only one
component, this is also the only place they need to exist. Do not commit their values
and do not create a repository `.env` file. `.do/app.yaml`'s top-level `envs:` list
documents what must exist; App Platform does not auto-sync it from the repo, so update
both places when adding a variable.

- `MONGODB_URI`: MongoDB Atlas TLS connection string
- `VALKEY_URL`: authenticated `rediss://` connection string
- `INTERACTION_TOKEN_SECRET`: at least 32 random bytes
- `CONFIG_ENCRYPTION_KEY`: at least 32 random bytes, independent from the token secret
- `SESSION_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `API_KEY_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `ADMIN_BOOTSTRAP_TOKEN`: at least 32 random bytes; remove after first admin setup
- `BREVO_API_KEY`: production transactional-email API key
- `EMAIL_FROM`: verified POWEROTP sender address
- `PUBLIC_APP_URL` / `PUBLIC_API_URL`: both `https://powerotp.com` (see Domains below)
- `DEMO_PROJECT_SLUG`: optional; slug of the project backing the public "try it now"
  widget on the marketing site. Committed as `demo`; after deploy, sign in at
  `/admin` and click "Provision demo project" once to create it at that exact slug.
  Leave the variable unset to keep the demo endpoints disabled.
- `OUTBOUND1_URL` / `OUTBOUND1_USER` / `OUTBOUND1_PASS` through `OUTBOUND4_*`: optional
  VoIP.ms trunk credentials, one dedicated outbound per verification method
  (`OUTBOUND1`=`call_reachability`, `OUTBOUND2`=`voice_code`,
  `OUTBOUND3`=`voice_challenge`, `OUTBOUND4`=`sms_code`) — see
  `apps/api/src/outbound-trunks.ts`. Leave unset until Phase 4 telephony wiring.

The committed `SET_IN_APP_PLATFORM` values are deliberate invalid placeholders. Replace
them in DigitalOcean before the first deployment.

## Domains

There is exactly one public web-facing domain, `powerotp.com` (plus `na1.powerotp.com`,
which points directly at the first telephony droplet, not App Platform). One process
serves every path on that single domain — `PUBLIC_APP_URL` and `PUBLIC_API_URL` are
therefore both `https://powerotp.com`. Do not create separate `app.`/`api.`/`mcp.`
subdomains or point either URL at one; the app will build broken absolute URLs (e.g.
`statusUrl`) if it does.

## Release checks

App Platform should use Node 22. The build command runs `npm ci` from `/`, then builds
contracts, mcp, web, and api in that dependency order (the API process embeds the
already-built web app and mcp handler at runtime). A deployment is healthy only when:

- `/health` returns `200`
- `/ready` returns `200` once Atlas and Valkey are reachable
- `/v1/capabilities` returns the verification types/states (proves the API routes are
  actually being served, not falling through to the Next.js 404 page)
- `/` returns the marketing site

The app intentionally fails startup when required configuration is missing or data
stores are unreachable.
