# DigitalOcean App Platform setup

Set this app up in DigitalOcean exactly the same way as every other app here: connect
the GitHub repo through the normal "Create App" flow and let App Platform auto-detect
the build/run commands. There is no App Spec YAML to paste in and nothing infrastructure-
as-code about this — the root `package.json`'s `build`/`start` scripts already do the
right thing for a plain Node.js app.

## Repository selection

- Repository: `Ericsipad/POWEROTP`
- Branch: `main`
- Source directory: `/` (not a subfolder — this is an npm workspace monorepo and the
  build needs the root lockfile plus the shared library packages)
- Auto-detected environment: Node.js

App Platform should detect `npm run build` and `npm run start` from the root
`package.json` automatically. If it asks you to confirm or override them, they should
read exactly:

- Build command: `npm run build`
- Run command: `npm start`
- HTTP port: whatever App Platform assigns via its `PORT` environment variable (the app
  reads it automatically; you don't need to hardcode one)

## One component, one normal Next.js app

Everything — the marketing/dashboard site, the customer and verification API under
`/v1`, its durable background workers, and the public `/mcp` integration guide — is one
Next.js app (`apps/web`), built and run like any other Next.js app. `apps/api` and
`apps/mcp` are library code imported by it, not separate services. There is nothing else
to create in App Platform: one app, one component.

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

Enter these once as environment variables in the App Platform UI (your app's Settings →
App-Level Environment Variables, same as your other apps). Do not commit their values
and do not create a repository `.env` file.

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
  widget on the marketing site — use `demo`. After deploy, sign in at `/admin` and click
  "Provision demo project" once to create it at that exact slug. Leave the variable
  unset to keep the demo endpoints disabled.
- `OUTBOUND1_URL` / `OUTBOUND1_USER` / `OUTBOUND1_PASS` through `OUTBOUND4_*`: optional
  VoIP.ms trunk credentials, one dedicated outbound per verification method
  (`OUTBOUND1`=`call_reachability`, `OUTBOUND2`=`voice_code`,
  `OUTBOUND3`=`voice_challenge`, `OUTBOUND4`=`sms_code`) — see
  `apps/api/src/outbound-trunks.ts`. Leave unset until Phase 4 telephony wiring.

## Domains

There is exactly one public web-facing domain, `powerotp.com` (plus `na1.powerotp.com`,
which points directly at the first telephony droplet, not App Platform). One process
serves every path on that single domain — `PUBLIC_APP_URL` and `PUBLIC_API_URL` are
therefore both `https://powerotp.com`. Do not create separate `app.`/`api.`/`mcp.`
subdomains or point either URL at one; the app will build broken absolute URLs (e.g.
`statusUrl`) if it does.

## Release checks

App Platform should use Node 22. A deployment is healthy only when:

- `/health` returns `200`
- `/ready` returns `200` once Atlas and Valkey are reachable
- `/v1/capabilities` returns the verification types/states (proves the API routes are
  actually being served, not falling through to the Next.js 404 page)
- `/` returns the marketing site

The app intentionally fails startup when required configuration is missing or data
stores are unreachable.
