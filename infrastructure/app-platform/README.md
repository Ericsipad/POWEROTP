# DigitalOcean App Platform connection

## Repository selection

- Repository: `Ericsipad/POWEROTP`
- Branch: `main`
- Source directory for every component: `/`
- App specification: [`.do/app.yaml`](../../.do/app.yaml)

The source directory must be `/`, not `/apps/web` or another subfolder. This is an npm
workspace monorepo and each component needs the root lockfile plus shared contracts.

## Components

- `web`: Next.js marketing and account application
- `api`: Fastify control plane and durable background queue processing
- `mcp`: public read-only integration MCP server

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

Enter secrets in each component’s encrypted environment-variable panel. Do not commit
their values and do not create a repository `.env` file.

### API

- `MONGODB_URI`: MongoDB Atlas TLS connection string
- `VALKEY_URL`: authenticated `rediss://` connection string
- `INTERACTION_TOKEN_SECRET`: at least 32 random bytes
- `CONFIG_ENCRYPTION_KEY`: at least 32 random bytes, independent from the token secret
- `SESSION_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `API_KEY_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `ADMIN_BOOTSTRAP_TOKEN`: at least 32 random bytes; remove after first admin setup
- `BREVO_API_KEY`: production transactional-email API key
- `EMAIL_FROM`: verified POWEROTP sender address
- `PUBLIC_APP_URL`: final HTTPS web origin
- `PUBLIC_API_URL`: final HTTPS API origin

### Web and MCP

No application environment variables are required during Phase 1.

The committed `SET_IN_APP_PLATFORM` values are deliberate invalid placeholders. Replace
them in DigitalOcean before the first deployment.

## Domains

The initial app ingress supports the shared App Platform domain:

- `/` → web
- `/v1` → API
- `/mcp` → MCP

Add `app.powerotp.com`, `api.powerotp.com`, and `mcp.powerotp.com` after DNS is available,
then update `PUBLIC_API_URL` and the published MCP snippets. Domain routing must be tested
before removing the shared-domain paths.

## Release checks

App Platform should use Node 22. The build commands run `npm ci` from `/` and compile only
the component plus shared contracts. A deployment is healthy only when:

- Web returns `200` from `/api/health`
- API returns `200` from `/health` and can reach Atlas/Valkey through `/ready`
- MCP returns `200` from `/health`
- API can reach Atlas and Valkey before accepting background work

The API intentionally fails startup when required configuration is missing or data stores
are unreachable.
