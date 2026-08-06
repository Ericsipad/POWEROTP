# As-built log

This is the ground truth of what actually exists right now — architecture decisions,
infrastructure that has real credentials behind it, and deviations from `PLAN.md`'s
original phase descriptions. `PLAN.md` describes the intended direction; this file
describes what is actually running today and why, so a new session (or a new agent)
doesn't have to reverse-engineer it from the commit history.

**Update this file in the same commit whenever you change architecture, infrastructure,
or deployment shape** — not for every code change, only for things a future session
would otherwise have to rediscover the hard way.

## Current architecture

One app, one DigitalOcean App Platform component, no App Spec YAML:

- `apps/web` is the only deployed thing. It is a normal Next.js app —
  `npm run build` / `npm start`, nothing custom. Every API endpoint (`/v1/*`, `/mcp`,
  `/health`, `/ready`) is a Next.js Route Handler under `apps/web/app`.
- `apps/api` and `apps/mcp` are **library-only** packages now (no server, no `start`
  script that binds a port). `apps/web` imports them directly via package exports, e.g.
  `import { AuthService } from "@powerotp/api/auth-service.js"`. Both packages expose a
  wildcard `exports` map (`"./*.js": "./dist/*.js"`) so any built module is importable.
- `apps/web/lib/server-context.ts` is the single process-wide singleton: it connects
  Mongo/Valkey, runs `ensureIndexes`, builds the BullMQ queues/workers, and constructs
  `AuthService`/`ProjectService`/`VerificationService`. `apps/web/instrumentation.ts`
  calls it eagerly on server boot (Next.js's official startup hook) so bad config fails
  fast instead of on the first request.
- `apps/web/lib/{api-route,api-errors,session-cookies,rate-limit}.ts` reimplement, using
  plain Next.js/Fetch APIs, what Fastify plugins used to do: correlation IDs + error
  mapping, session/CSRF cookies, and a Valkey-backed fixed-window rate limiter.
- MCP is mounted at `apps/web/app/mcp/route.ts`, which calls
  `createMcpTransport()` (from `@powerotp/mcp/mcp-app.js`) and delegates directly —
  `transport.handleRequest(request)` already speaks the Fetch API, so no bridging layer
  is needed inside Next.js. `apps/mcp` still has its own tiny standalone Node-http
  bootstrap (`apps/mcp/src/server.ts`) for running the MCP guide in isolation locally;
  it is not used in production.

### Why this shape (history, so it doesn't get re-litigated)

Earlier in this project we tried, in order: (1) three separate App Platform components
(`web`/`api`/`mcp`) with ingress path-routing — this is what Phase 1–3 originally
shipped, and it turned out DigitalOcean's actual deployed app never had matching ingress
rules applied, so `/v1/*` and `/mcp` silently 404'd into the Next.js catch-all in
production; (2) one component running a hand-rolled custom server that embedded Next.js
programmatically and bridged Fastify/MCP into it — this worked but was flagged as
needlessly different from every other app in this account; (3) the current shape: a
plain Next.js app with the API as Route Handlers and no separate services or custom
server at all. This is the one to keep building on.

## Deployment (DigitalOcean App Platform)

- Set up via the normal "Create App" → connect GitHub repo flow, **no App Spec YAML**.
  Node.js is auto-detected from `package.json`; build/run commands read `npm run build`
  / `npm start`.
- Environment variables are entered once as **app-level** variables in the DO UI (not
  per-component — there's only one component anyway). See
  [`infrastructure/app-platform/README.md`](../infrastructure/app-platform/README.md)
  for the full list and what each one is for.
- Domain: `powerotp.com` only. There are **no** `app.`/`api.`/`mcp.` subdomains —
  `PUBLIC_APP_URL` and `PUBLIC_API_URL` are both `https://powerotp.com`. Do not create
  those subdomains or repoint the URLs at them.
- Health check path: `/health`. Readiness (Mongo+Valkey reachable): `/ready`.
- Verify a deploy actually worked by hitting `/v1/capabilities` — if it returns the
  Next.js 404 HTML instead of JSON, the deploy is broken (this exact failure mode is
  what caused the App Platform rework above).

## Infrastructure that has real credentials behind it

- **MongoDB Atlas**: cluster `dev-cluster-0` (`*.eojgwbd.mongodb.net`), database
  `powerotp`. Confirmed by the user to be the same value as the live `MONGODB_URI`.
  Collections are created lazily by `ensureIndexes()` on first successful boot.
- **Valkey**: DigitalOcean Managed Database, already provisioned and set as `VALKEY_URL`
  in App Platform. Used for both the rate limiter and BullMQ (dispatch/timeout/callback
  queues via `apps/api/src/verification-queue.ts`).
  - **Known fixed bug**: BullMQ job IDs cannot contain `:`. Job IDs are
    `dispatch-${interactionId}` / `timeout-${interactionId}` / `callback-${eventId}`
    (hyphens), not colons. If you see `"Custom Id cannot contain :"` in logs, something
    reintroduced a colon into a `jobId`.
- **Demo project**: a real `ProjectDocument` was inserted directly into production Mongo
  (via the MongoDB MCP tool, since this environment has no standing DB credentials) at
  `_id: "prj_demo"`, `slug: "demo"`, owned by `usr_platform_admin`, all four verification
  methods enabled. `DEMO_PROJECT_SLUG=demo` is the App Platform env var that activates
  the public "try it now" widget against it. There is also an idempotent admin-only
  `POST /v1/admin/demo-project` endpoint (button on `/admin`) that can recreate/refresh
  this project if it's ever lost — safe to click repeatedly.
- **Telephony droplet**: `powerotpvoip1`, Ubuntu 24.04.4 LTS, IP `178.128.235.192`, DNS
  `na1.powerotp.com` (already pointed at it). SSH access from this machine is via the
  alias `ssh powerotp` — defined in a **local-only, gitignored** Cursor rule
  (`.cursor/rules/droplet-ssh-access.mdc`) that does not sync across machines or get
  committed. If that alias ever fails on a fresh machine, it needs to be re-created
  there (ask the user, don't ask them to re-paste raw credentials into chat if avoidable).
  Hardened (key-only SSH via a new sudo user `opsadmin`, `ufw` default-deny inbound except
  22, `fail2ban`) and has Asterisk 20 + Node.js 22 installed and running — see "Telephony
  droplet" below for the full detail. The telephony-agent itself is not deployed there
  yet and no node has been enrolled, so no real call/SMS traffic is possible yet.
- **VoIP.ms**: account exists per the user, but no trunk credentials have been provided
  or configured yet. `OUTBOUND1_URL/USER/PASS` through `OUTBOUND4_*` are declared as
  optional env vars (one dedicated trunk per verification method — see
  `apps/api/src/outbound-trunks.ts`) but are unset placeholders in production.

## Phase status vs. `PLAN.md`

- **Phases 0–2**: implemented as originally planned (accounts, projects, API keys,
  callbacks).
- **Phase 3 (verification core)**: implemented — idempotent creation, durable state
  machine, events, BullMQ queues, signed HMAC callbacks with SSRF guarding, single-use
  interaction tokens, status endpoint, dashboard timeline. Verified end-to-end against
  real production Mongo/Valkey. Since no real telephony/SMS transport exists yet, every
  verification currently resolves `queued → dispatching → failed` with reason
  `method_not_available` — this is expected, not a bug, until Phase 4 lands.
- **Public demo widget**: added ahead of Phase 4 (not in the original phase list) — a
  "try it now" widget on the marketing homepage hero, backed by the anonymous, tightly
  scoped `/v1/demo/verifications` endpoints and the `prj_demo` project above.
- **Phase 4 (voice types 1 and 2 / telephony)**: **in progress.** Node identity (one
  shared `NODE_SECRET`, not mTLS or a per-node enrollment secret — see "Phase 4 node
  identity" below) is implemented and confirmed working end-to-end: `powerotpvoip1` is
  hardened, running Asterisk 20 + Node.js 22, and its `powerotp-agent` service
  authenticates to the control plane, pulls configuration, and reloads Asterisk on
  every change. Not yet done: real VoIP.ms trunk credentials and all dialplan/ARI
  call-control logic.
- **Phases 5–9**: not started.

## Platform admin auth (changed from the original TOTP design)

The original Phase 2 design (and `PLAN.md`/`THREAT_MODEL.md` at the time) required a
database-registered admin account with mandatory TOTP, created via a one-time
`/v1/admin/bootstrap` endpoint gated by `ADMIN_BOOTSTRAP_TOKEN`. The user explicitly
asked to simplify this to match how they configure admin access on their other
projects: **no TOTP, no bootstrap endpoint, no self-service admin account at all.**

Current model: there is exactly one platform admin, and its entire identity lives in
environment variables — `ADMIN_EMAIL`, `ADMIN_PASSWORD` (plain value, compared directly
at login, not hashed), and `ADMIN_ALLOWED_IPS` (comma-separated exact IPs; no CIDR).
Login requires all three to match — email, password, and client IP — with a single
generic `invalid_credentials` error regardless of which check failed, so a caller can't
tell which part was wrong. `apps/api/src/auth-service.ts#loginAdmin` upserts a minimal
`usr_platform_admin` database record on successful login purely so the existing
session/cookie machinery (built for customer accounts) keeps working unchanged — that
record is not itself a credential; the env vars are the only real credential. There is
no recovery flow: changing the password or IP allowlist is editing env vars and
redeploying.

`isIpAllowed()` in `apps/api/src/ip-allowlist.ts` reads the client IP from
`clientIp()` in `apps/web/lib/api-route.ts`, which prefers Cloudflare's
`cf-connecting-ip` header (Cloudflare sits in front of App Platform) over
`x-forwarded-for`.

If a future session is asked to "add MFA back" or "let customers become admins" — don't,
without re-confirming with the user first; this was a deliberate simplification, not an
oversight.

## Phase 4 node identity (implemented, corrected design)

Confirmed with the user, in two steps:

1. True mutual TLS is not pursued (not straightforward to terminate on App Platform's
   shared ingress).
2. **The first replacement (a per-node hashed secret generated through an admin "enroll"
   flow and hand-copied onto the droplet) was explicitly rejected by the user** — the
   requirement is that a droplet is *never* individually configured or edited after
   deployment. All configuration, without exception, is entered once in App Platform and
   distributed to every node automatically.

The actual design: **one shared secret, `NODE_SECRET`**, entered once in App Platform —
the same "single env var, compared directly, no database record" convention this app
already uses for `ADMIN_PASSWORD`. Every droplet is deployed with the same
`CONTROL_PLANE_URL` and the same `NODE_SECRET` baked in at deployment time; there is no
per-node enrollment step, nothing to individually revoke, and nothing an operator ever
edits on a running node. A new droplet just needs those same two constants to start
pulling full configuration immediately. Rotating access is changing `NODE_SECRET` in App
Platform and redeploying every node with the new value — identical in spirit to how
`ADMIN_PASSWORD`/`ADMIN_ALLOWED_IPS` already work.

- Contracts: `libraries/contracts/src/nodes.ts` — just `NodeSchema` (a connection-log
  entry: id/ip/firstSeenAt/lastSeenAt, for `/admin` visibility only, not access control)
  and `NodeConfigSchema` (trunks).
- `apps/api/src/node-service.ts` (`NodeService`): `list` (admin visibility),
  `authenticate` (constant-time compare of the `Authorization: Bearer` header against
  `config.NODE_SECRET`; on success, upserts a connection-log row keyed by source IP as a
  liveness heartbeat), `configFor` (returns whichever `OUTBOUND1..4_*` trunks are
  currently configured — identical response for every node, never any other app secret).
- Routes: `GET /v1/admin/nodes` (admin session, read-only — nothing to create or revoke),
  `GET /v1/nodes/config` (shared secret, no admin session — the droplet-facing endpoint).
- `/admin`'s "Telephony nodes" panel is now read-only: it lists whichever source IPs have
  successfully authenticated with `NODE_SECRET`, with first/last-seen times. A node
  appears automatically the first time it polls; there is no enroll button.
- **Config flows one direction only, on demand**: App Platform env vars are the only
  source of truth; a droplet never receives, stores, or has anyone edit any other app
  secret. A node polls `/v1/nodes/config` (see `apps/telephony-agent/src/index.ts`) and,
  when `ASTERISK_PJSIP_TRUNKS_PATH` is set, renders the trunks it received into a local
  PJSIP include file (`apps/telephony-agent/src/pjsip-config.ts`) and asks the local
  Asterisk to `pjsip reload` — but only when the rendered config actually changed since
  the last poll (including the very first poll right after the process starts), so an
  idle node doesn't reload Asterisk every interval for no reason. Dialplan/ARI
  call-control logic is intentionally not built yet — there is no real trunk to test it
  against until VoIP.ms credentials are entered.
- The droplet's `/etc/powerotp/agent.env` holds only non-secret, unchanging deployment
  constants (`CONTROL_PLANE_URL`, `ASTERISK_PJSIP_TRUNKS_PATH`, `POLL_INTERVAL_MS`) plus
  `NODE_SECRET` itself, which the agent was deployed with directly — the operator never
  logs in to place or change it; the session doing the deployment writes it once as part
  of standing the node up.

## Telephony droplet (`powerotpvoip1`) — hardening and base install done

Real changes made directly on the droplet via `ssh powerotp` (see
`.cursor/rules/droplet-ssh-access.mdc`, local-only):

- **SSH/access**: created a sudo, key-only login user `opsadmin` (same authorized key as
  root) and confirmed it works with `sudo` before changing anything else. Set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in `sshd_config` —
  password auth is fully disabled account-wide; root can still only ever log in with the
  same key, never a password. Installed and enabled `fail2ban`.
- **Firewall**: `ufw` is active, default-deny incoming, only `22/tcp` (SSH) allowed in.
  Nothing else — no ARI, AMI, or Asterisk port is reachable from outside the box, matching
  the threat model.
- **Unattended upgrades**: already correctly configured by DigitalOcean's base image
  (security-origin automatic updates enabled) — verified, not changed.
- **Asterisk**: installed from Ubuntu 24.04's apt repo — Asterisk 20 (LTS), already running
  as the non-root `asterisk` system user via its packaged systemd unit
  (`asterisk -U asterisk`). ARI is enabled in `http.conf`/`ari.conf`, bound to
  `127.0.0.1` only (never exposed publicly), with one local ARI user
  (`powerotp-agent`) whose generated password lives only in
  `/etc/powerotp/ari.env` (root-only, `600`) on the droplet — it is never sent to or
  stored by the control plane. `pjsip.conf` includes `pjsip_trunks.conf`, which the agent
  owns and rewrites on every successful config poll. `extensions.conf` has a placeholder
  `[powerotp-outbound]` context (just logs and hangs up) so the endpoint config has
  somewhere to point until real dialplan/ARI call-control logic is built against a live
  trunk.
- **Node.js 22** installed from NodeSource for running the agent.
- **`apps/telephony-agent` is deployed and running.** Transfer mechanism: `git archive`
  at a committed `main` commit → `scp` → extract to `/opt/powerotp` → `npm ci` → `npm run
  build -w @powerotp/contracts -w @powerotp/telephony-agent`, owned by a new non-login
  system user `potp-agent` (member of the `asterisk` group so it can read/write
  `pjsip_trunks.conf` and reach the Asterisk control socket). Runs under the hardened
  systemd unit `infrastructure/asterisk/powerotp-agent.service` (also installed at
  `/etc/systemd/system/powerotp-agent.service` on the droplet) — see that file's comment
  for one hardening option that must **not** be set: `MemoryDenyWriteExecute=true` made
  the process crash immediately with `SIGTRAP` because it blocks the W^X page mappings
  Node's V8 JIT needs at startup.
- The deploying session generated the real `NODE_SECRET` value and wrote it directly into
  `/etc/powerotp/agent.env` over SSH — this is the one and only value that ever needs to
  reach the droplet, and the session standing the node up does it, never the platform
  operator by hand. The identical value is set as `NODE_SECRET` in App Platform.
  **Confirmed working end-to-end**: `powerotp-agent` on `powerotpvoip1` authenticates,
  fetches config, and reloads Asterisk on every change (see the "Incident" notes below
  for two issues hit and fixed along the way).

**Status as of the last session: fully working end-to-end.** `NODE_SECRET` and the
`OUTBOUND1..4_*` placeholders are set in App Platform and deployed; `powerotp-agent` on
`powerotpvoip1` authenticates, fetches config, renders `pjsip_trunks.conf`, and
successfully reloads Asterisk (`"trunk configuration changed; reloaded pjsip"` in its
logs). One deploy-time incident and its fix are recorded below so they aren't
re-discovered the hard way.

### Incident: empty-string optional env vars crashed the whole app

Setting `NODE_SECRET` in App Platform briefly took the entire site down (`/health`,
`/`, everything — 500 from three independent network paths, not just the new node
route), even though DigitalOcean's own dashboard reported the deploy as healthy. Root
cause: App Platform lets an operator create an env var with a blank value instead of
omitting it, which `ProductionConfigSchema` treated as invalid for optional fields — and
because `instrumentation.ts` calls `loadConfig()` eagerly at boot to fail fast on bad
config (by design), one blank optional variable crashed the entire process, not just the
feature it was for. Fixed in `apps/api/src/config.ts#loadConfig`: empty-string values are
now filtered out before parsing, so "unset" and "set to blank" are equivalent for
optional fields, while a required field left empty still correctly fails fast. Covered by
`apps/api/src/config.test.ts`. If a future deploy goes fully dark again (every route,
including `/health`), suspect a config validation crash first and check for this pattern
before anything else.

### Incident: agent couldn't reload Asterisk (control socket permissions)

Asterisk's packaged `systemd` unit doesn't reliably honor `asterisk.conf`'s
`astctlpermissions`/`astctlgroup` settings on this build — the control socket
(`/var/run/asterisk/asterisk.ctl`) kept coming back owner-only-write
(`srwxr-xr-x asterisk:asterisk`) on every restart, so `potp-agent` (member of group
`asterisk`) could connect but not issue `pjsip reload`. Fixed with a `systemd` drop-in
(the exact mechanism the packaged unit's own comments recommend, not a one-off `chmod`
the next restart would silently undo): `infrastructure/asterisk/asterisk.service.d-override.conf`,
installed at `/etc/systemd/system/asterisk.service.d/override.conf` on the droplet, adds
`ExecStartPost=/bin/chmod 660 /var/run/asterisk/asterisk.ctl` — reliable because the unit
is `Type=notify`, so `ExecStartPost` only runs after Asterisk's ready notification, which
comes after the socket is created.

## Known gaps / next steps

1. Build the actual dialplan/ARI call-control logic once VoIP.ms trunk credentials are
   real and a trunk registers successfully — currently `[powerotp-outbound]` is a
   placeholder that just hangs up, and `configuredTypes` in the agent's logs is `[]`
   until real `OUTBOUND1..4_*` values are entered.
2. Everything else in Phases 4–9 per `docs/PLAN.md`.
