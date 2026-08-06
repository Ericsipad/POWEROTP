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
- **Phase 4 (voice types 1 and 2 / telephony)**: **in progress.** Node identity/enrollment
  (bearer secret, not mTLS — see "Phase 4 node identity" below) is implemented end-to-end
  in the control plane. The droplet is hardened, and Asterisk 20 + Node.js 22 are
  installed and running. Not yet done: deploying the agent itself onto the droplet,
  enrolling that node, real VoIP.ms trunk credentials, and all dialplan/ARI call-control
  logic.
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

## Phase 4 node identity (implemented; not yet enrolled)

Confirmed with the user: true mutual TLS is not pursued (not straightforward to terminate
on App Platform's shared ingress). Node identity is a **per-node hashed bearer secret**,
issued once at enrollment and sent as `Authorization: Bearer <secret>` — structurally the
same pattern as a project API key, deliberately reusing `API_KEY_HASH_SECRET` for hashing
rather than adding a second near-identical secret.

- Contracts: `libraries/contracts/src/nodes.ts` (`CreateNodeSchema`, `NodeSchema`,
  `NodeEnrolledSchema`, `NodeConfigSchema`).
- `apps/api/src/node-service.ts` (`NodeService`): `enroll` (admin-only, returns the secret
  exactly once), `list`, `revoke`, `authenticate` (bearer secret → active `NodeDocument`,
  also stamps `lastSeenAt` as a liveness heartbeat), `configFor` (returns whichever
  `OUTBOUND1..4_*` trunks are currently configured in App Platform — never any other app
  secret).
- Routes: `POST/GET /v1/admin/nodes` and `POST /v1/admin/nodes/[nodeId]/revoke` (admin
  session + CSRF), `GET /v1/nodes/config` (node bearer secret, no admin session — this is
  the droplet-facing endpoint).
- `/admin` has a "Telephony nodes" panel: enroll a node (name + region), see the secret
  once, list nodes with last-seen time, revoke.
- **Config flows one direction only, on demand**: App Platform env vars
  (`OUTBOUND1..4_*`) are the source of truth; a droplet never receives or stores any other
  app secret. A node polls `/v1/nodes/config` (see `apps/telephony-agent/src/index.ts`)
  and, when `ASTERISK_PJSIP_TRUNKS_PATH` is set, renders the trunks it received into a
  local PJSIP include file (`apps/telephony-agent/src/pjsip-config.ts`) and asks the local
  Asterisk to `pjsip reload`. Dialplan/ARI call-control logic is intentionally not built
  yet — there is no real trunk to test it against until VoIP.ms credentials are entered.
- **No node has been enrolled yet.** The droplet's agent is installed and running (see
  below) but is not yet authenticated — it will log `node secret rejected` until an
  operator enrolls it at `/admin` and copies the resulting secret into
  `/etc/powerotp/agent.env` on the droplet.

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
- **`apps/telephony-agent` is deployed and enabled, but not yet enrolled.** Transfer
  mechanism: `git archive` at a committed `main` commit → `scp` → extract to
  `/opt/powerotp` → `npm ci` → `npm run build -w @powerotp/contracts -w
  @powerotp/telephony-agent`, owned by a new non-login system user `potp-agent` (member
  of the `asterisk` group so it can read/write `pjsip_trunks.conf` and reach the Asterisk
  control socket). Runs under the hardened systemd unit
  `infrastructure/asterisk/powerotp-agent.service` (also installed at
  `/etc/systemd/system/powerotp-agent.service` on the droplet) — see that file's comment
  for one hardening option that must **not** be set: `MemoryDenyWriteExecute=true` made
  the process crash immediately with `SIGTRAP` because it blocks the W^X page mappings
  Node's V8 JIT needs at startup. The service is currently **stopped** (not crash-looping)
  because `/etc/powerotp/agent.env` still has the placeholder
  `NODE_SECRET=REPLACE_ME_AFTER_ENROLLMENT`, which correctly fails config validation
  (`loadAgentConfig`) rather than starting with an invalid secret — `systemctl start
  powerotp-agent` once the real secret is in place.

## Known gaps / next steps

1. Sign in at `/admin`, enroll `powerotpvoip1` under "Telephony nodes", and run (on the
   droplet) `systemctl edit --full powerotp-agent` or edit `/etc/powerotp/agent.env`
   directly to replace `NODE_SECRET=REPLACE_ME_AFTER_ENROLLMENT` with the real secret
   shown exactly once at enrollment, then `systemctl start powerotp-agent`.
2. Get real VoIP.ms trunk credentials from the user and enter them as `OUTBOUND1..4_*` in
   the App Platform UI (the user has said they will enter these directly; no code change
   needed — the schema already exists in `apps/api/src/config.ts`).
3. Once a trunk is live end-to-end (agent renders it into `pjsip_trunks.conf`, Asterisk
   registers to VoIP.ms), build the actual dialplan/ARI call-control logic — currently
   `[powerotp-outbound]` is a placeholder that just hangs up.
4. Everything else in Phases 4–9 per `docs/PLAN.md`.
