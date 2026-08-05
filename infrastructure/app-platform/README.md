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
- `api`: Fastify control-plane API
- `mcp`: public read-only integration MCP server
- `worker`: private background worker

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

Enter secrets in each component’s encrypted environment-variable panel. Do not commit
their values and do not create a repository `.env` file.

### API

- `NODE_ENV=production`
- `MONGODB_URI`: MongoDB Atlas TLS connection string
- `VALKEY_URL`: authenticated `rediss://` connection string
- `INTERACTION_TOKEN_SECRET`: at least 32 random bytes
- `CONFIG_ENCRYPTION_KEY`: at least 32 random bytes, independent from the token secret
- `PUBLIC_API_URL`: final HTTPS API origin

### Worker

- `NODE_ENV=production`
- `MONGODB_URI`
- `VALKEY_URL`

### Web and MCP

- `NODE_ENV=production`

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
- Worker starts with valid production configuration

The API intentionally fails startup when required configuration is missing or data stores
are unreachable.
