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

One repository, two self-contained DigitalOcean App Platform components:

- `frontend` is a frontend-only Next.js app for `https://powerotp.com`. It serves the
  marketing site, dashboard/admin pages, auth pages, and hosted widget. Browser API
  calls use `frontend/lib/api-client.ts` and `NEXT_PUBLIC_API_URL`. Its browser API
  models and lockfile are frontend-local; it imports nothing from `/backend` or root.
- `backend/apps/server` is an API-only Next.js app for `https://api.powerotp.com`. Every API
  endpoint (`/v1/*`, `/mcp`, `/health`, `/ready`) is a Route Handler under
  `backend/apps/server/app`.
- `backend/packages/api` and `backend/packages/mcp` remain **library-only** packages.
  `backend/apps/server` imports them directly via package exports. They, the backend
  contracts/signing packages, manifest, and lockfile all live below `/backend`.
- `backend/apps/server/lib/server-context.ts` owns Mongo/Valkey, index setup, BullMQ
  queues/workers, and service construction. `backend/apps/server/instrumentation.ts` starts it
  eagerly. The frontend has no datastore secrets, connections, or background workers.
- `backend/apps/server/lib/{api-route,api-errors,session-cookies,rate-limit}.ts` provide
  correlation IDs, error mapping, host-only session/CSRF cookies, and rate limiting.
  `backend/apps/server/proxy.ts` allows credentialed browser CORS only from configured exact
  origins; cookies remain `Secure`, host-only, and `SameSite=Strict`.
- MCP is mounted at `backend/apps/server/app/mcp/route.ts`, which calls
  `createMcpTransport()` (from `@powerotp/mcp/mcp-app.js`) and delegates directly —
  `transport.handleRequest(request)` already speaks the Fetch API, so no bridging layer
  is needed inside Next.js. `backend/packages/mcp` still has its own tiny standalone Node-http
  bootstrap (`backend/packages/mcp/src/server.ts`) for running the MCP guide in isolation locally;
  it is not used in production.

### Why this shape (history, so it doesn't get re-litigated)

Earlier in this project we tried, in order: (1) three separate App Platform components
(`web`/`api`/`mcp`) with ingress path-routing — this is what Phase 1–3 originally
shipped, and it turned out DigitalOcean's actual deployed app never had matching ingress
rules applied, so `/v1/*` and `/mcp` silently 404'd into the Next.js catch-all in
production; (2) one component running a hand-rolled custom server that embedded Next.js
programmatically and bridged Fastify/MCP into it — this worked but was flagged as
needlessly different from every other app in this account; (3) a single Next.js app
containing both frontend and Route Handlers. The current split keeps standard Next.js
Route Handlers but uses separate hostnames instead of fragile ingress path-routing,
providing process-level failure isolation and independent horizontal scaling.

## Deployment (DigitalOcean App Platform)

- Set up via the normal "Create App" → connect GitHub repo flow, **no App Spec YAML**.
  Frontend uses source `frontend`; backend uses source `backend` (DigitalOcean source
  directories are repository-relative and have no leading slash). Each runs
  `npm run build` / `npm start` using only files below its source directory. Both
  components were deployed from commit `e6812d5` after the standalone split.
- Server secrets are backend-component variables. The frontend receives only public
  URL configuration. See
  [`infrastructure/app-platform/README.md`](../infrastructure/app-platform/README.md)
  for the full list and what each one is for.
- Domains: frontend `powerotp.com`; backend `api.powerotp.com`.
  `PUBLIC_APP_URL=https://powerotp.com` and
  `PUBLIC_API_URL=https://api.powerotp.com`.
- Frontend browser calls use `NEXT_PUBLIC_API_URL=https://api.powerotp.com`.
  Backend-generated API links use `PUBLIC_API_URL`; modal/widget, email, and Stripe
  return UI links use `PUBLIC_APP_URL`. Stripe's webhook is
  `https://api.powerotp.com/v1/billing/stripe/webhook`.
- Frontend health check: `/api/health`. Backend health/readiness: `/health`, `/ready`.
- Verify the backend by hitting `https://api.powerotp.com/v1/capabilities` — if it returns the
  Next.js 404 HTML instead of JSON, the deploy is broken (this exact failure mode is
  what caused the App Platform rework above).

## Infrastructure that has real credentials behind it

- **MongoDB Atlas**: cluster `dev-cluster-0` (`*.eojgwbd.mongodb.net`), database
  `powerotp`. Confirmed by the user to be the same value as the live `MONGODB_URI`.
  Collections are created lazily by `ensureIndexes()` on first successful boot.
- **Valkey**: DigitalOcean Managed Database, already provisioned and set as `VALKEY_URL`
  in App Platform. Used for both the rate limiter and BullMQ (dispatch/timeout/callback
  queues via `backend/packages/api/src/verification-queue.ts`).
  - **Known fixed bug**: BullMQ job IDs cannot contain `:`. Job IDs are
    `dispatch-${interactionId}` / `timeout-${interactionId}` / `callback-${eventId}`
    (hyphens), not colons. If you see `"Custom Id cannot contain :"` in logs, something
    reintroduced a colon into a `jobId`.
- **Demo project**: a real `ProjectDocument` was inserted directly into production Mongo
  (via the MongoDB MCP tool, since this environment has no standing DB credentials) at
  `_id: "prj_demo"`, `slug: "demo"`, owned by `usr_platform_admin`, all four verification
  methods enabled. `DEMO_PROJECT_SLUG=demo` is the App Platform env var that activates
  the public "try it now" widget against it — **confirm this is actually set** before
  assuming the demo widget works; it was found unset in a later session despite this
  note previously assuming it was configured. There is also an idempotent admin-only
  `POST /v1/admin/demo-project` endpoint (button on `/admin`) that can recreate/refresh
  this project if it's ever lost — safe to click repeatedly. **Known-fixed bug**: that
  manual Mongo insert stored `activatedAt` as a plain string instead of a BSON `Date`
  (an artifact of inserting via the MCP tool's JSON interface), which crashed
  `ProjectService#toResponse`'s `activatedAt.toISOString()` every time this endpoint
  ran (`"e.activatedAt.toISOString is not a function"` in App Platform runtime logs).
  Fixed by having `ensureDemoProject` always `$set` (not `$setOnInsert`) `activatedAt`,
  so re-running the endpoint self-heals any legacy bad value.
- **Droplet auto-deploy**: as of this session, `powerotpvoip1` redeploys itself
  automatically on every push to `main` (once `verify` passes), the same as
  `frontend` already does on App Platform — see `.github/workflows/verify.yml`'s
  `deploy-droplet` job and `infrastructure/asterisk/README.md`. It uses four
  GitHub Actions secrets (`DROPLET_HOST`, `DROPLET_SSH_USER`,
  `DROPLET_SSH_KEY`, and pinned `DROPLET_SSH_HOST_KEY`). The CI key is
  separate from the local `ssh powerotp` key and is restricted to the
  forced `potp-deploy` command; the archive is streamed on stdin rather
  than copied with unrestricted SSH. **A future schema/contract change that the old agent can't parse
  (like the trunk-pool redesign two sessions ago) is no longer a "redeploy in
  the same sitting" manual reminder — it just happens automatically the
  moment the commit reaches `main`.** First-time node provisioning
  (hardening, Asterisk install, the systemd unit, `/etc/powerotp/*.env`) is
  scripted too, as `infrastructure/asterisk/bootstrap-node.sh` — see "Node
  rebuild / disaster recovery" below.
- **Telephony droplet**: `powerotpvoip1`, Ubuntu 24.04.4 LTS, IP `178.128.235.192`, DNS
  `na1.powerotp.com` (already pointed at it). SSH access from this machine is via the
  alias `ssh powerotp` — defined in a **local-only, gitignored** Cursor rule
  (`.cursor/rules/droplet-ssh-access.mdc`) that does not sync across machines or get
  committed. If that alias ever fails on a fresh machine, it needs to be re-created
  there (ask the user, don't ask them to re-paste raw credentials into chat if avoidable).
  Hardened (key-only SSH via a new sudo user `opsadmin`, `ufw` default-deny inbound except
  22, `fail2ban`), running Asterisk 20 + Node.js 22, and `apps/telephony-agent` is
  deployed and running there as the hardened systemd service `powerotp-agent` — see
  "Phase 4 node identity" and "Telephony droplet" below for full detail. **Confirmed
  live**: it authenticates to the control plane with the shared `NODE_SECRET`, pulls its
  flat trunk pool, and rotates/fails over across whichever trunks are currently
  `Registered` — see "Outbound trunk pool: rotation and failover" below for the live
  multi-trunk failover confirmation.
- **VoIP.ms**: account exists, four SIP subaccounts as of this session
  (`334140_power1/power2/power3` plus a 4th added mid-session). Trunk credentials are a
  flat pool (`TRUNK1_URL/USER/PASS` .. `TRUNK6_URL/USER/PASS`, see "Outbound trunk pool:
  rotation and failover" below), not tied to a verification type. **Confirmed live**:
  `TRUNK1` and `TRUNK4` register and place calls successfully; `TRUNK2`/`TRUNK3`
  (`334140_power2/power3`) still register but get `403 Forbidden` on every call
  attempt (unchanged from the prior session's finding — see the "known-gap" incident
  below, this needs VoIP.ms support, not further local debugging) — the trunk pool's
  live failover was confirmed skipping both of them automatically. SMS uses a separate
  credential pair: `VOIPMS_SMS_API_USERNAME`/`VOIPMS_SMS_API_PASSWORD` (VoIP.ms's
  REST/JSON API account email + API key, not a SIP username/password) plus whichever
  `TRUNKn_DID` values are set — **confirmed live and working end-to-end** this session
  after fixing a real bug (see "Phase 6 SMS provider adapter" below for the
  multipart/form-data incident).
- **DigitalOcean Spaces**: not provisioned yet. `SPACES_ENDPOINT/BUCKET/ACCESS_KEY/
  SECRET_KEY` and the independent `MEDIA_MANIFEST_SECRET` are unset placeholders — see
  "Phase 5" below. The admin recording/challenge APIs and `voice_challenge` are
  code-complete and unit-tested against this deferred configuration; they fail closed
  (`media_storage_not_configured` / `no_published_challenges`) until it is set.

## Phase status vs. `PLAN.md`

- **Phases 0–2**: implemented as originally planned (accounts, projects, API keys,
  callbacks).
- **Phase 3 (verification core)**: implemented — idempotent creation, durable state
  machine, events, BullMQ queues, signed HMAC callbacks with SSRF guarding, single-use
  interaction tokens, status endpoint, dashboard timeline. Verified end-to-end against
  real production Mongo/Valkey. Real transports were added in later phases; each method
  still fails closed with `method_not_available` when its required live credentials are
  absent.
- **Public demo widget**: added ahead of Phase 4 (not in the original phase list) — a
  "try it now" widget on the marketing homepage hero, backed by the anonymous, tightly
  scoped `/v1/demo/verifications` endpoints and the `prj_demo` project above.
- **Phase 4 (voice types 1 and 2 / telephony)**: **implemented, both types have
  real call-control logic** (`voice_code` added after `call_reachability` was proven
  live — see "Phase 4 ARI call-control" below for both). Node identity (one
  shared `NODE_SECRET`, not mTLS or a per-node enrollment secret — see "Phase 4 node
  identity" below) is implemented and confirmed working end-to-end: `powerotpvoip1` is
  hardened, running Asterisk 20 + Node.js 22, and its `powerotp-agent` service
  authenticates to the control plane, pulls configuration, and reloads Asterisk on
  every change. `call_reachability` now has real ARI call-control logic (see "Phase 4
  ARI call-control" below) — **confirmed working end-to-end against a real live call**:
  a demo-widget request against a real destination number went
  `queued -> dispatching -> calling -> succeeded` (`reasonCode: "answered"`) after the
  droplet actually originated the call over VoIP.ms, detected the answer via ARI's
  `StasisStart`, and reported it back through the control plane's real transition/event
  machinery. `voice_code` uses the same live node path. `voice_challenge` call-control
  and media synchronization are implemented, but remain operationally unavailable until
  Spaces/media configuration exists. A busy/no-answer/rejected outcome has not been
  observed live (only the cause-code mapping is unit-tested), and there is no automated
  canary test for this — it was exercised manually once.
  **Observed nuance, not a bug**: on that canary call the callee's phone was never
  tapped to answer (recipient hit "Ignore" on an Apple Watch, which only silences the
  local ring, not a SIP-level decline) — the call rang for ~20s and the carrier's
  *voicemail system* sent the real SIP `200 OK`, which is genuinely indistinguishable
  from a human answering at the SIP signaling level (confirmed via the Asterisk CDR:
  `disposition=ANSWERED`, ~20s ring before answer, matching typical carrier
  no-answer-to-voicemail timing, not typical human reaction time). This is exactly the
  documented scope of Type 1 (`docs/PRODUCT_SPEC.md`: "Reports whether the destination
  answered; it does not prove ownership") — voicemail pickup correctly counts as
  "reachable", just not as "a person engaged". If voicemail-as-answered false positives
  ever need to be reduced, options for a future session: shorten
  `CALL_RING_TIMEOUT_SECONDS` below typical carrier voicemail timeouts (lossy — real
  people vary in answer speed too), or add Asterisk's AMD (answering-machine detection)
  app before treating a `StasisStart` as a true reachability success (Phase 9-level
  hardening, not urgent for the current product contract).
- **Phase 5 (voice_challenge / recording pipeline)**: implemented and unit-tested end to
  end — admin recording upload/normalization, immutable challenge authoring, per-
  interaction opaque option materialization and grading, signed media manifest, node
  media sync, and ARI recording playback. See "Phase 5 recording/challenge pipeline"
  below. Live Spaces credentials remain deliberately deferred; trunk credentials
  themselves are shared with the other voice methods via the pool (see
  "Outbound trunk pool: rotation and failover").
- **Phase 6 (SMS)**: provider adapter implemented, unit-tested, and confirmed live
  end-to-end with VoIP.ms; it still fails closed when the SMS API credentials or a
  configured sender DID are absent.
- **Phase 7**: implemented — see "Phase 7: usage counters, callback
  diagnostics, alerting, retention" below.
- **Phase 8 (integration surface)**: substantially implemented this
  session — see "Hosted verification modal" below. MCP deepening and a
  completed (private, unpublished) server SDK cover "API documentation"
  and "SDK starters"; the hosted modal covers "widget loader". Not done:
  publishing `@powerotp/server-sdk`/`@powerotp/widget-loader` to a public
  registry (deliberately deferred — see that section).
- **Phase 9**: not started.

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
tell which part was wrong. `backend/packages/api/src/auth-service.ts#loginAdmin` upserts a minimal
`usr_platform_admin` database record on successful login purely so the existing
session/cookie machinery (built for customer accounts) keeps working unchanged — that
record is not itself a credential; the env vars are the only real credential. There is
no recovery flow: changing the password or IP allowlist is editing env vars and
redeploying.

`isIpAllowed()` in `backend/packages/api/src/ip-allowlist.ts` reads the client IP from
`clientIp()` in `backend/apps/server/lib/api-route.ts`, which prefers Cloudflare's
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

- Contracts: `backend/packages/contracts/src/nodes.ts` — just `NodeSchema` (a connection-log
  entry: id/ip/firstSeenAt/lastSeenAt, for `/admin` visibility only, not access control)
  and `NodeConfigSchema` (trunks).
- `backend/packages/api/src/node-service.ts` (`NodeService`): `list` (admin visibility),
  `authenticate` (constant-time compare of the `Authorization: Bearer` header against
  `config.NODE_SECRET`; on success, upserts a connection-log row keyed by source IP as a
  liveness heartbeat), `configFor` (returns every fully-configured `TRUNK1..6_*` trunk in
  the pool as a flat array — identical response for every node, never any other app
  secret; see "Outbound trunk pool: rotation and failover" below for the full design).
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
  At the time this identity/config-polling slice landed, dialplan/ARI call-control was
  intentionally not part of it; the later "Phase 4 ARI call-control" section records
  the subsequently implemented live behavior.
- The droplet's `/etc/powerotp/agent.env` holds only non-secret, unchanging deployment
  constants (`CONTROL_PLANE_URL`, `ASTERISK_PJSIP_TRUNKS_PATH`, `POLL_INTERVAL_MS`) plus
  `NODE_SECRET` itself, which the agent was deployed with directly — the operator never
  logs in to place or change it; the session doing the deployment writes it once as part
  of standing the node up.

## Phase 4 ARI call-control (`call_reachability` and `voice_code`, implemented)

The control plane never talks to Asterisk/ARI directly — only a droplet's
`apps/telephony-agent` does, over ARI bound to `127.0.0.1`. Since a node only ever
*polls* the control plane (never the reverse), a second, much faster poll loop was
added alongside the existing 60-second trunk-config sync so call dispatch doesn't wait
a full minute:

- `backend/packages/api/src/transport.ts#createNodeDispatchTransport` replaces the voice methods'
  `unavailableTransport` stub: it still fails immediately with `method_not_available` if
  no trunk is configured (unchanged behavior), but once one is, it advances the
  interaction to `dispatching` and stops — that state *is* the signal a node polls for.
  `voice_challenge` also now uses `createNodeDispatchTransport` (see "Phase 5
  recording/challenge pipeline" below — its content precondition, a published
  challenge, is checked synchronously at creation, not here). `sms_code` uses a
  separate in-process HTTPS adapter described below; it never enters this node queue.
- `VerificationService.claimNextForNode(type)` atomically hands the oldest
  still-`dispatching` interaction of a type to whichever node asks next (`dispatching ->
  calling`, the state machine's normal next active state — MongoDB's `findOneAndUpdate`
  makes double-claims impossible even with multiple nodes).
- Two node-facing routes, both `NODE_SECRET`-authenticated like `/v1/nodes/config`:
  `GET /v1/nodes/jobs/next?type=call_reachability` (claim, `204` if nothing is waiting)
  and `POST /v1/nodes/jobs/{interactionId}/events` (report progress/result). The report
  endpoint reuses `VerificationService.transition` — a node gets exactly the same
  durable event/callback machinery as everything else — and `NodeJobEventSchema`
  restricts what a node may report to `ringing`/`answered`/`playing`/
  `awaiting_response`/`succeeded`/`failed`/`canceled`; only the control plane itself
  ever sets `queued`/`dispatching`/`calling`.
- On the droplet, `apps/telephony-agent/src/job-poller.ts` polls the claim endpoint
  every `JOB_POLL_INTERVAL_MS` (default 2s) — but only for types it has an actual trunk
  configured for, and only once its ARI WebSocket is actually connected (claiming a job
  it can't receive events for would just run out the clock). On a claim it places one
  call at a time (serial, not concurrent — see "Known gaps") via
  `apps/telephony-agent/src/reachability-call.ts`, using
  `apps/telephony-agent/src/ari-client.ts` (a small wrapper over ARI's REST + WebSocket
  using Node 22's built-in `fetch`/`WebSocket`, no new dependency):
  - Originates `PJSIP/{targetNumber}@{trunkId}` directly into a Stasis app
    (`app` param on `POST /channels`) with a self-generated `channelId` (so event
    filtering can start before the HTTP response returns, closing a race where a fast
    busy/reject could otherwise arrive over the WebSocket first) and ARI's own `timeout`
    param (`CALL_RING_TIMEOUT_SECONDS`, default 30s) bounding how long it rings.
  - The WebSocket subscribes with `subscribeAll=true`: a channel that never answers
    never enters the Stasis app, so its `ChannelStateChange`/`ChannelDestroyed` events
    only arrive with a system-wide subscription, not an app-scoped one.
  - `StasisStart` (channel answered and entered the app) -> report `answered` then
    `succeeded`, and hang up immediately — `call_reachability` only needs to know it was
    answered, nothing plays. `ChannelDestroyed` (never answered) -> map its Q.850 `cause`
    code to a small stable reason-code vocabulary (`busy`, `no_answer`, `call_rejected`,
    `invalid_number`, `provider_unavailable`, or `call_failed`) -> report `failed`. A
    local hard timeout (ring timeout + 15s) guards against a lost WebSocket event
    stalling the job loop forever.
  - No dialplan/`extensions.conf` change was needed: originating directly into a Stasis
    app bypasses dialplan/context entirely, so the placeholder `[powerotp-outbound]`
    context remains genuinely unused for this flow (it would only matter for *inbound*
    calls to that endpoint, which don't exist).
- Covered by `apps/telephony-agent/src/reachability-call.test.ts` (hangup-cause mapping,
  answered/busy/originate-failure/unrelated-channel-event paths) using a fake ARI client
  — no live Asterisk/VoIP.ms dependency in automated tests, consistent with the
  fake-transport-only-in-tests rule.
- The origination/answer-detection logic (`apps/telephony-agent/src/originate-call.ts`)
  and hangup-cause mapping (`hangup-causes.ts`) were extracted as shared modules once a
  second method needed them, rather than duplicating: `voice_code`
  (`apps/telephony-agent/src/voice-code-call.ts`) reuses the exact same
  originate/wait-for-answer flow, then — once answered — plays the five-digit code as
  ARI digit playback, repeated per `CODE_REPEAT_COUNT` (currently 2), and hangs up once
  the final `PlaybackFinished` fires, resolving at `awaiting_response` (not a terminal
  state — the code is graded later by the existing, unchanged `submitCode` flow from
  Phase 3, not by anything the node does). `apps/telephony-agent/src/job-poller.ts` now
  tries each type this node has a trunk for in turn (currently `call_reachability` then
  `voice_code`) each poll cycle. **Confirmed working end-to-end live** (see "Outbound
  trunk pool" below for the exact trunk-failover log excerpt from that test).
  **Live-reported UX issue, fixed**: each repetition was originally sent as one ARI
  playback with both repeats joined by a comma (`media=digits:12345,digits:12345`),
  which plays back with zero gap between them — indistinguishable from ten digits in a
  row, with no way to tell where the first repetition ends and the second begins. Fixed
  by issuing each repetition as its own ARI playback with a real 2-second silent pause
  (`PAUSE_BETWEEN_REPEATS_MS`) in between (the call stays connected, just silent) —
  confirmed audibly correct on a live re-test. A spoken word (e.g. "again") between
  repetitions was considered but not implemented: Asterisk's stock sound library has no
  isolated "again"/"repeat" word (only full voicemail-menu phrases like `vm-repeat.wav`,
  "Press 5 to repeat the current message", which would be actively confusing spliced
  into a code readout), and there is no TTS engine installed on the droplet. Revisit
  only if the user wants to install a TTS engine (e.g. `espeak-ng`, robotic-sounding) or
  supplies a real recorded "again" clip — not done speculatively.
- **Security fix made alongside this**: a `voice_code` interaction's expected code was
  stored in plaintext (`VerificationRequestDocument#expectedCode`) since Phase 3, never
  actually exercised until now — direct violation of `docs/MVP_ACCEPTANCE.md` Type 2
  ("Codes never appear in ... stored plaintext"). Changed to
  `expectedCodeEncrypted` (authenticated encryption with `CONFIG_ENCRYPTION_KEY`, the
  same primitive already used for `ProjectDocument#callbackSecretEncrypted`), decrypted
  only transiently: once to compare against a submitted code
  (`VerificationService#submitCode`), and once to hand to the claiming node
  (`VerificationService#codeForDelivery`, called from the `jobs/next` route) — never
  logged, never returned in any API response. Also: a customer-supplied code was always
  optional per `docs/PRODUCT_SPEC.md`, but nothing generated one when omitted, so an
  omitted code could never actually succeed a submission; `VerificationService#create`
  now generates a cryptographically random five-digit code
  (`backend/packages/api/src/security.ts#createFiveDigitCode`) when one isn't supplied.

## Outbound trunk pool: rotation and failover (implemented)

Originally each voice verification type dialed out on its own dedicated VoIP.ms trunk
(`OUTBOUND1`=`call_reachability`, `OUTBOUND2`=`voice_code`, `OUTBOUND3`=`voice_challenge`).
Live-tested against real VoIP.ms in a prior session: `OUTBOUND1` (subaccount
`334140_power1`) worked end-to-end, but `OUTBOUND2`/`OUTBOUND3` (`334140_power2`/
`334140_power3`) registered fine yet got `403 Forbidden` on every outbound call — a
provider-side issue (see the incident note below), not a code bug, but it meant two of
three voice methods were blocked in production while waiting on VoIP.ms support. The user
explicitly asked for a redesign so numbers are pooled and rotated rather than pinned
one-per-type: *"these numbers are better used as a rotation failover ... any number
appears down it just uses the next number ... we can also keep working here while we
only have the one number working."*

**Design:**

1. **Config shape**: `TRUNK1_URL/USER/PASS` through `TRUNK6_URL/USER/PASS` (App Platform
   env vars, all optional, same empty-string-is-unset convention as every other optional
   field) replace the old per-type `OUTBOUND1..3_*` vars. `backend/packages/api/src/outbound-trunks.ts#allOutboundTrunks`
   returns every fully-configured trunk (`TRUNKn` where url/user/pass are all present) as
   a flat array tagged with a stable id (`trunk-1`, `trunk-2`, ...), in numeric order.
   `hasAnyOutboundTrunk` gates voice-method dispatch in `backend/packages/api/src/transport.ts` — any
   trunk can serve any of the three voice types now, so dispatch only checks "does at
   least one trunk exist at all", not a type-specific one. `backend/packages/contracts/src/nodes.ts#NodeConfigSchema.trunks`
   is the same flat, id-tagged array shape on the wire. Each `TRUNKn` also has an
   optional 4th field, `TRUNKn_DID` — that trunk's own phone number — which is *not*
   part of `allOutboundTrunks`'/`NodeConfig`'s shape (a telephony node never needs a
   DID, only SIP credentials) but is read independently by `backend/packages/api/src/outbound-trunks.ts#allTrunkDids`
   as the pool of sender numbers `sms_code` rotates across (see "Phase 6 SMS provider
   adapter" below) — one flat `TRUNKn_*` env var group now covers both what a node
   dials out with and what the control plane can text from, instead of a separate,
   easy-to-forget `VOIPMS_SMS_DID`.
2. **Selection happens on the telephony-agent (droplet) side**, not the control plane —
   only the agent can see live call outcomes over each trunk's registration, and this
   keeps the control plane's job unchanged ("please do a call_reachability call", never
   "please use trunk N"). `backend/packages/api/src/node-service.ts#configFor` just hands over the
   full pool; `apps/telephony-agent/src/pjsip-config.ts#renderPjsipTrunks` renders one
   PJSIP registration/auth/aor/endpoint/identify block per trunk id (`trunk-1`, `trunk-2`,
   ...) — no longer named after a verification type at all.
3. **`apps/telephony-agent/src/trunk-pool.ts`** (`TrunkPool`, new module) tracks health
   and rotation in-process on the agent:
   - `pickHealthyTrunks()` returns currently-healthy trunk ids in round-robin order,
     starting from the least-recently-tried — with exactly one healthy trunk configured
     (today's real-world state) it always wins, zero special-casing needed.
   - `reportOutcome(trunkId, reasonCode)` updates a per-trunk consecutive-failure streak.
     `isProviderLevelFailure(reasonCode)` names which reason codes count as a
     circuit/account-level trunk problem (`provider_unavailable`, `call_rejected`) versus
     which prove the call reached the network fine and must reset the streak to 0
     (`busy`, `no_answer`, `invalid_number`, or a real success) — a destination declining
     or not answering must never falsely blacklist a healthy trunk.
   - After 3 consecutive provider-level failures a trunk is marked "down" for a cool-down
     window (starts at 5 minutes, doubles on each further failure once retried, capped at
     60 minutes, resets to 5 minutes after a success) — a half-open retry model, so a
     trunk VoIP.ms fixes server-side becomes eligible again automatically, no redeploy.
   - `updateTrunkIds(trunkIds)` is called every config poll so trunks added/removed in
     App Platform take effect on the running agent within one poll cycle.
4. **Within one call attempt**, `apps/telephony-agent/src/job-poller.ts#runJobWithFailover`
   tries the job against every currently-healthy trunk in rotation order: a
   provider-level failure immediately retries the *same* job on the next healthy trunk
   (calling `reportOutcome` after every attempt, before deciding whether to retry) — the
   literal "if any number appears down, it just uses the next number" behavior, applied
   within one customer's verification attempt, not just across separate ones. A
   legitimate destination-side outcome (busy/no_answer/invalid_number) is never retried
   on another trunk — it's not the trunk's fault, and it would just re-ring the same
   recipient. Retrying stops once an attempt succeeds/reaches `awaiting_response`, every
   currently-healthy trunk has been tried once, or there are zero healthy trunks at all
   (reports `method_not_available`, same as today's "no trunk configured" behavior). The
   job-poller race fix from commit `20cc038` (chaining every progress/result report for
   one job through a single promise, regardless of which trunk attempt it came from) is
   unchanged by this refactor — still exactly one `/events` request in flight at a time.
5. **Geo-diverse servers**: no special-casing needed — the design already treats trunks
   generically regardless of which VoIP.ms server/region backs them. Adding a
   geo-diverse number later is purely a `TRUNKn_*` env var addition, no code change. Not
   built in this pass: multi-node routing across droplets (that's Phase 9, out of scope
   here) — this is single-droplet, multi-trunk rotation.

**Env var rename required in App Platform** (values unchanged, only the names — App
Platform requires manually renaming a variable, not just editing a value):

| Old name            | New name         |
| -------------------- | ---------------- |
| `OUTBOUND1_URL`      | `TRUNK1_URL`      |
| `OUTBOUND1_USER`     | `TRUNK1_USER`     |
| `OUTBOUND1_PASS`     | `TRUNK1_PASS`     |
| `OUTBOUND2_URL`      | `TRUNK2_URL`      |
| `OUTBOUND2_USER`     | `TRUNK2_USER`     |
| `OUTBOUND2_PASS`     | `TRUNK2_PASS`     |
| `OUTBOUND3_URL`      | `TRUNK3_URL`      |
| `OUTBOUND3_USER`     | `TRUNK3_USER`     |
| `OUTBOUND3_PASS`     | `TRUNK3_PASS`     |

A redeploy (App Platform, for the control plane) and a droplet redeploy (see
`infrastructure/asterisk/README.md`) are both required for this to take effect —
`pjsip show registrations` on the droplet should then show `trunk-1`/`trunk-2`/`trunk-3`
(or however many are configured) instead of the old `trunk-call-reachability`/
`trunk-voice-code`/`trunk-voice-challenge` names.

### Known gap / incident: VoIP.ms `403 Forbidden` on two of three subaccounts

Live-tested against real VoIP.ms in a prior session. Canary destination:
`+14034701805`. `OUTBOUND1`/`334140_power1` (now `TRUNK1`): confirmed working
end-to-end, multiple times. `OUTBOUND2`/`334140_power2` and `OUTBOUND3`/`334140_power3`
(now `TRUNK2`/`TRUNK3`): the trunk **registers fine**, but every outbound call attempt
gets `403 Forbidden` from VoIP.ms — confirmed via a live SIP packet capture
(`pjsip set logger on`) that this happens *after* successful digest authentication
(VoIP.ms challenges with a 401, Asterisk retries with a valid digest, VoIP.ms responds
403 directly on the authenticated `INVITE`) — this rules out a credentials problem.
Already ruled out, in this order, so don't re-litigate without new evidence:

1. CallerID Number setting on the affected subaccounts (changed to match the working
   one — no effect).
2. "Allow International Calls" toggle (turned off to match the working one — no effect).
3. Full side-by-side comparison of both subaccounts' Edit Sub Account pages in the
   VoIP.ms portal — visually identical to the working one, still 403.

Also observed (from Asterisk's own historical logs, predating the session that found
this): both affected subaccounts got an outright fatal 403 on **registration itself**
one night, before self-resolving — a stronger signal than a settings mismatch, and
consistent with a VoIP.ms account-side hold/flag on those two subaccounts specifically.
Also: after an agent restart, the affected subaccounts get a much shorter registration
expiry window (~7 min) than the working one (~54 min) — another server-side difference.
**Conclusion**: this needs VoIP.ms support to resolve on their account backend; nothing
in the subaccount settings UI explains it. If VoIP.ms fixes it, just retest via the demo
endpoint below — no code change needed. This exact scenario (temporarily working with
only one healthy trunk while others are blocked by the provider) is precisely why the
trunk pool above was built — it makes the system resilient to it automatically.

How to live-test any voice type via the public anonymous demo widget backing endpoint
(gated by `DEMO_PROJECT_SLUG` being set):

```
POST https://api.powerotp.com/v1/demo/verifications
Body: {"type":"call_reachability","targetNumber":"+14034701805"}
```

then poll `GET https://api.powerotp.com/v1/demo/verifications/{interactionId}` until a
terminal-ish state. Check agent logs (`sudo journalctl -u powerotp-agent`) for which
trunk id actually got used and whether a failover retry happened.

### Live confirmation: rotation and mid-attempt failover, real broken trunks

Confirmed end to end in the same session the pool was built, against the exact
real-world scenario it was designed for. The droplet was redeployed with the new
`apps/telephony-agent` code (`git archive` → `scp` → `npm ci` → `npm run build` →
`chown` → `systemctl restart powerotp-agent`, per `infrastructure/asterisk/README.md`;
swap confirmed present first) and the user added a 4th VoIP.ms subaccount/trunk
(`TRUNK4`) mid-session. Post-redeploy, `pjsip show registrations` showed:

```
trunk-1/sip:sanjose2.voip.ms   Registered
trunk-2/sip:sanjose2.voip.ms   Rejected
trunk-3/sip:sanjose2.voip.ms   Rejected
trunk-4/sip:sanjose2.voip.ms   Registered
```

A live `voice_code` demo request then produced this agent log sequence:

```
claimed call job ... type: voice_code
provider-level failure on trunk; retrying on the next healthy trunk, trunkId: trunk-2, reasonCode: call_rejected
provider-level failure on trunk; retrying on the next healthy trunk, trunkId: trunk-3, reasonCode: call_rejected
call job finished ... state: awaiting_response, reasonCode: code_played
```

— i.e. `runJobWithFailover` tried `trunk-2` first (rotation order), got `call_rejected`
(a provider-level failure per `isProviderLevelFailure`), immediately retried `trunk-3`
(also `call_rejected`), then succeeded on the next healthy trunk in rotation order —
all within one call attempt, zero manual intervention, and the interaction still
resolved correctly (`awaiting_response`/`code_played`) from the customer's perspective.
This is the literal live-world version of the design goal: two known-broken VoIP.ms
subaccounts (`trunk-2`/`trunk-3`) were automatically skipped every time, with capacity
spread across the two healthy ones (`trunk-1`/`trunk-4`).

One operational note for a future redeploy: since `NodeConfigSchema.trunks` changed
shape (type-keyed object → flat array) in this same session, a droplet running the
*old* agent against the *new* control-plane response fails closed on **every** config
poll (`"config sync failed","error":"... expected object, received array"`), which
also means it can't resolve `configuredTypes` for **any** voice type, not just the
newly-added ones — a full trunk-pool schema change like this always needs the droplet
redeployed in the same sitting as the control-plane deploy, not "whenever's
convenient". A job claimed before the redeploy is not lost, though — it just sits at
`dispatching` until the redeployed agent's next poll cycle claims it (confirmed: the
very first live test in this session appeared "stuck" at `dispatching` for a few
minutes, then completed successfully the moment the redeployed agent came up).

## Phase 5 recording/challenge pipeline (`voice_challenge`, implemented)

`voice_challenge` (Type 3) is code-complete and unit-tested end to end: admin-authored
recordings and challenges, private Spaces storage, a signed media manifest, node media
sync, and ARI recording playback — reusing the same encrypted-secret and node-dispatch
machinery already proven for `voice_code` rather than introducing anything new.

- **Contracts**: `backend/packages/contracts/src/challenges.ts` (`ChallengeSchema`,
  `ChallengeSubmissionSchema`, `CreateChallengeSchema`, `RecordingAsset`) already existed
  before this phase and needed no changes; `NodeJobSchema` in
  `backend/packages/contracts/src/nodes.ts` gained an optional `soundBasename` for claimed
  `voice_challenge` jobs.
- **Storage**: two new Mongo collections, `recordingAssets` and `challengeDefinitions`
  (`backend/packages/api/src/challenge-persistence.ts`), plus a `{ type, state, createdAt }` index on
  the verification collection to support `claimNextForNode` filtering by type at scale
  (`backend/packages/api/src/persistence.ts`). The verification document's previously-unused
  singular `answerOptionId` field was replaced with an embedded, per-interaction
  `challenge` snapshot (`challengeDefinitionId`, freshly shuffled `challengeOptions`,
  `expectedAnswerOptionIdsEncrypted`) — see `backend/packages/api/src/verification-persistence.ts`.
- **`backend/packages/api/src/media-service.ts`**: validates an admin upload (magic-byte sniffing for
  WAV/MP3/M4A, a hard size cap rejected before even inspecting contents) and normalizes
  it with `@ffmpeg-installer/ffmpeg` (an npm static binary, not a DigitalOcean Aptfile —
  App Platform's Aptfile buildpack doesn't reliably expose system FFmpeg at runtime) to
  8kHz mono, matching the existing PJSIP `allow=ulaw,alaw` codec config so the output is
  directly playable via ARI's `sound:` media type with no dialplan change. Also computes
  the SHA-256 checksum a node later verifies before trusting a download.
- **`backend/packages/api/src/spaces-client.ts`**: a thin S3-compatible wrapper (`@aws-sdk/client-s3`
  + `@aws-sdk/s3-request-presigner`) over the private Spaces bucket — `putObject` for
  admin publish, `presignedGetUrl` (short-lived) for node download. Telephony droplets
  never hold Spaces credentials at all, matching the "no per-node secrets" node-identity
  model; a node instead receives one presigned URL per recording from the manifest
  route below.
- **`backend/packages/api/src/challenge-service.ts`** (`ChallengeService`): admin `publishRecording`/
  `createChallenge`/`listRecordings`/`listChallenges`/`retireRecording`/`retireChallenge`
  (soft-retire only — an immutable Spaces object and any challenge/interaction already
  referencing it are left untouched, so retiring never breaks an in-flight interaction);
  `selectAndMaterialize` (random selection of one published challenge whose recording is
  also still published, fresh per-interaction opaque option IDs in random order,
  encrypted correct-set re-derived under those new IDs — never the admin's stable option
  keys, so nothing outside this one call ever learns which key was correct);
  `gradeSubmission` (exact-set match against `minSelections`/`maxSelections`/
  `allowsMultiple`, decrypting only transiently); `currentManifest` (the signed manifest
  + presigned URLs described below).
- **`VerificationService`** (`backend/packages/api/src/verification-service.ts`): `create()` binds a
  challenge synchronously via `selectAndMaterialize()` for `voice_challenge` — a missing
  published challenge is a content-catalog precondition, so it fails the request
  immediately with `no_published_challenges` (409), the same way a bad E.164 number or
  unsupported method already does, rather than waiting until dispatch like an
  unconfigured trunk. `toStatus()` only includes `challenge` (question/options, never
  correctness information) once the verification has reached `awaiting_response` or a
  later terminal state (`hasReachedAwaitingResponse()` in
  `backend/packages/api/src/verification-state-machine.ts`) — never at `queued`/`dispatching`/
  `calling`/etc., so a status poll can't see the challenge before the recording has
  actually been dispatched for playback. `submitChallenge()` grades a submission the
  same way `submitCode()` grades a voice/SMS code, and `soundBasenameForDelivery()`
  mirrors `codeForDelivery()` for the claiming node.
- **`backend/packages/api/src/transport.ts`**: `voice_challenge` now uses
  `createNodeDispatchTransport`, identical in shape to `call_reachability`/`voice_code` —
  it still fails immediately with `method_not_available` if no trunk is configured in
  the pool at all; the challenge-content precondition above is checked earlier, at
  creation, not here.
- **Admin routes** (`backend/apps/server/app/v1/admin/recordings/route.ts` + `[id]/route.ts`,
  `backend/apps/server/app/v1/admin/challenges/route.ts` + `[id]/route.ts`): session + CSRF gated
  exactly like `/v1/admin/demo-project` (`requireAdminSession` + `verifyCsrfHeader`; IP
  allowlisting is enforced once at admin login, not re-checked per request, consistent
  with every other admin route). `/admin`'s new `challenges-panel.tsx` wires recording
  upload and challenge authoring into the existing admin page.
- **`GET /v1/nodes/media-manifest`** (`backend/apps/server/app/v1/nodes/media-manifest/route.ts`):
  `NODE_SECRET`-authenticated exactly like `/v1/nodes/config`, no per-node identity.
  Returns `204` when nothing is published yet (no Spaces/manifest-secret configuration,
  or no published challenge currently references a recording) — the agent's media-sync
  loop treats that as "nothing to do", not an error. `GET /v1/nodes/jobs/next` now
  attaches `soundBasename` for a claimed `voice_challenge` job.
- **`apps/telephony-agent/src/media-sync.ts`**: a poll loop (alongside the existing
  trunk-config and job-claim loops) that verifies the manifest's signature, downloads
  and checksum-verifies each referenced recording, and does an atomic local
  install/removal under `MEDIA_ROOT` — a partially-downloaded or corrupt file is never
  left where Asterisk could try to play it. Does nothing when `MEDIA_ROOT`/
  `MEDIA_MANIFEST_SECRET` are unset, so a node that never handles `voice_challenge`
  doesn't need this configuration at all.
- **`apps/telephony-agent/src/voice-challenge-call.ts`**: mirrors `voice-code-call.ts`'s
  originate → wait-for-answer flow, then plays the synced recording via ARI's
  `sound: playback` (not digit playback) and resolves at `awaiting_response` once
  `PlaybackFinished` fires — grading happens later via the unchanged `submitChallenge`
  flow, not by anything the node does. `job-poller.ts` tries `voice_challenge` in the
  same per-poll-cycle loop as the other two voice types, only when this node has at
  least one trunk in the pool and its media-sync loop is enabled.
- **Response route**: `POST /v1/verifications/{interactionId}/response` now branches on
  verification type to accept `ChallengeSubmissionSchema` (opaque option IDs) alongside
  the existing code path; the browser-response interaction token reuses the existing
  `submit_challenge` action that already existed in the contracts.
- **New optional config**: `SPACES_ENDPOINT`/`SPACES_BUCKET`/`SPACES_ACCESS_KEY`/
  `SPACES_SECRET_KEY` and an independent `MEDIA_MANIFEST_SECRET` (never reused for
  `NODE_SECRET`) in `backend/packages/api/src/config.ts` — all optional, all covered by the same
  empty-string-is-unset sanitization as every other optional field (see the "empty-string
  optional env vars" incident above), so `voice_challenge` and the admin
  recording/challenge APIs fail closed with `media_storage_not_configured` (Spaces not
  configured) or `no_published_challenges` (nothing published yet) until every one of
  these is set.

### Incident: `@ffmpeg-installer/ffmpeg` broke the production build under Turbopack

`npm run build` (`next build`, Turbopack) failed with `Module not found: Can't resolve
'.../@ffmpeg-installer/win32-x64/package.json'` once `media-service.ts` (imported
transitively by `server-context.ts` → `challenge-service.ts`) reached a server route.
Root cause: `@ffmpeg-installer/ffmpeg` resolves its platform binary via dynamic
`require()` branching at runtime — code Turbopack cannot statically analyze and bundle
correctly. Fixed by adding `serverExternalPackages: ["@ffmpeg-installer/ffmpeg",
"@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]` to `frontend/next.config.ts` —
Next.js's documented mechanism for telling the bundler to leave a package as a real
Node `require()` at runtime instead of statically bundling it (the AWS SDK packages were
included proactively since they carry similarly dynamic optional dependencies, even
though the original build error only named `ffmpeg-installer`). If a future dependency
with a platform-specific or `require()`-branching binary breaks the build the same way,
add it to this same list rather than re-discovering the mechanism from scratch.

## Phase 6 SMS provider adapter (`sms_code`, implemented)

`sms_code` is executed entirely by the control plane. It does not use Asterisk, ARI,
the telephony-agent, a SIP trunk, or the node-facing job queue:

- `VerificationService#create` generates a cryptographically random five-digit SMS code
  and stores only `expectedCodeEncrypted`, using the same authenticated encryption and
  response-grading path as `voice_code`. The customer cannot supply an SMS code.
- `backend/packages/api/src/sms.ts#createVoipMsSmsService` calls VoIP.ms's `sendSMS` REST method
  over HTTPS. Credentials (`VOIPMS_SMS_API_USERNAME`/`VOIPMS_SMS_API_PASSWORD`) are
  VoIP.ms's REST/JSON API account email + API key — a different credential pair from
  the SIP trunk credentials, entered separately in App Platform. Parameters are sent
  as POST form data so the API password never appears in a request URL. **The sending
  DID is not a separate hardcoded variable** (there was originally a single
  `VOIPMS_SMS_DID`, replaced during the trunk-pool session below): `sendSMS` still
  requires exactly one origin DID per call — every SMS needs a single "from" number,
  the same as everywhere else — but `backend/packages/api/src/outbound-trunks.ts#allTrunkDids`
  reuses whichever `TRUNKn_DID` values are configured (see "Outbound trunk pool"
  below) as the pool of numbers `sms_code` can send from, and `sms.ts` rotates
  round-robin across all of them, falling over to the next one if a send is rejected
  for a provider-level reason — so every SMS-capable number is usable, not just one.
  `TRUNKn_DID` is deliberately never sent to a telephony node (`allOutboundTrunks`,
  used for node config, never includes it) — nodes only need SIP credentials to dial
  out, never a DID.
- `backend/packages/api/src/transport.ts#createSmsCodeTransport` drives
  `queued -> dispatching -> awaiting_response` after provider acceptance and normalizes
  provider/API failures to stable `provider_rejected` or `provider_unavailable` reason
  codes. The atomic `queued -> dispatching` transition is also the send claim, so a
  BullMQ retry cannot submit the same SMS twice. Missing or partial credentials retain
  the production-safe `method_not_available` behavior.
- The existing `POST /v1/verifications/{interactionId}/response` endpoint now grades
  both `voice_code` and `sms_code`; browser-response interaction tokens use the same
  existing `submit_code` action.
- **Confirmed working end-to-end live**: a demo-widget `sms_code` request against a
  real destination number resolved `queued -> dispatching -> awaiting_response`
  (`reasonCode: "code_sent"`) after VoIP.ms actually accepted the send.

### Incident: SMS sends failed with a misleading `provider_unavailable` (wrong POST content-type)

Live-testing `sms_code` for the first time (after `VOIPMS_SMS_API_USERNAME/PASSWORD`
and at least one `TRUNKn_DID` were finally set in App Platform) consistently failed
with `provider_unavailable` — which, per `sms.ts`'s error handling, only happens on a
network-level failure (not a credential rejection, which would be the more specific
`provider_rejected`). Two false leads were investigated and ruled out live before
finding the real cause, recorded here so they aren't re-investigated from scratch:

1. **VoIP.ms IP allowlist** ("SOAP and REST/JSON API" page in the portal): checked via
   a user-provided screenshot — the `Enable IP Addresses` field already contained
   VoIP.ms's own "allow all" wildcard notation, so the account wasn't restricting by
   source IP. Not the cause.
2. **Cloudflare blocking DigitalOcean's IP range**: `voip.ms` does sit behind
   Cloudflare (confirmed via `Server: cloudflare` in response headers), and
   datacenter-IP-blocking WAF rules are a real, common pattern — a plausible-sounding
   theory that turned out to be wrong. Ruled out once the actual response was captured
   (see below) instead of only theorizing.

**Root cause, found by adding diagnostic logging** (`sms.ts#logSmsFailure`, logs HTTP
status + a truncated response-body preview on every failure path, never credentials —
this logging is a permanent, useful addition, not a one-off debug hack) **and then
reading real App Platform runtime logs**: VoIP.ms returned a **`500` SOAP fault**
(`env:Envelope`/`env:Fault`/`env:Sender`, reason "Bad Request") for a POST with an
`application/x-www-form-urlencoded` body — even with otherwise-correct parameters and
credentials. Reproduced independently (unrelated network, dummy credentials): the exact
same URL-encoded POST got the same `500` SOAP fault, while switching only the body
encoding to `multipart/form-data` got a clean `200` JSON response
(`{"status":"invalid_credentials",...}` for the dummy creds — the *right* kind of
rejection). **Conclusion**: VoIP.ms's REST endpoint only actually accepts
`multipart/form-data` for POST (a GET with query params also works, but would put the
API password in the URL/access logs, exactly what POST is meant to avoid). **Fixed**:
`sms.ts` now builds the request body with `FormData` instead of `URLSearchParams`, and
lets `fetch` set the `multipart/form-data; boundary=` header itself rather than setting
`content-type` manually. If a future non-2xx VoIP.ms error appears again, check the new
diagnostic log line first — it will show the actual status/body preview rather than
requiring re-discovery of this same investigation.

## Telephony droplet (`powerotpvoip1`) — hardening and base install done

Real changes made directly on the droplet via `ssh powerotp` (see
`.cursor/rules/droplet-ssh-access.mdc`, local-only):

- **SSH/access**: created a sudo, key-only login user `opsadmin` (same authorized key as
  root) and confirmed it works with `sudo` before changing anything else. Set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in `sshd_config` —
  password auth is fully disabled account-wide; root can still only ever log in with the
  same key, never a password. Installed and enabled `fail2ban`.
  **Superseded — root login is now closed outright (`PermitRootLogin no`) and
  `ssh powerotp` lands as `opsadmin`; see "Droplet deploy hardening" below.**
- **Firewall**: `ufw` is active, default-deny incoming, only `22/tcp` (SSH) allowed in.
  Nothing else — no ARI, AMI, or Asterisk port is reachable from outside the box, matching
  the threat model. **Egress is no longer unrestricted either — see "Droplet deploy
  hardening" below.**
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
  trunk. **Also added a `[transport-udp]` PJSIP transport directly to `pjsip.conf`** —
  every transport in the packaged sample config ships commented out, and with zero active
  transports `res_pjsip_outbound_registration` silently fails to create any registration
  object at all (`res_sorcery_config.c: Could not create an object of type 'registration'
  with id '...'` in `/var/log/asterisk/messages.log`, with no other symptom — the
  endpoint/aor/auth/identify objects from the same file load fine, which is what made this
  confusing). This is droplet-level infrastructure, not something the agent renders,
  because it doesn't vary per trunk.
- **Confirmed live**: with real `TRUNK1_URL/USER/PASS` (San Jose VoIP.ms server, renamed
  from `OUTBOUND1_*` in the trunk-pool redesign) and, as of this session, `TRUNK4_*`
  (a 4th subaccount) set in App Platform, the agent rendered all four trunks and
  `pjsip show registrations` shows `trunk-1` and `trunk-4` as `Registered` against
  VoIP.ms (`trunk-2`/`trunk-3` register too but get rejected on calls — see "Outbound
  trunk pool" above) — outbound SIP registration and rotation/failover both work
  end-to-end.
- **Node.js 22** installed from NodeSource for running the agent.
- **`apps/telephony-agent` is deployed and running.** Transfer mechanism: `git archive`
  at a committed `main` commit → piped to the forced-command deploy entrypoint on stdin →
  extract to `/opt/powerotp` → `npm ci` → `npm run
  build -w @powerotp/contracts -w @powerotp/telephony-agent`. (This used to be a separate
  `scp` plus an inline root command list; see "Droplet deploy hardening" below for why it
  is one stdin-piped forced command now.) `/opt/powerotp` is owned by the CI user
  `potp-deploy`; the agent itself runs as the non-login
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

**Status as of this session: fully working end-to-end, including live multi-trunk
failover.** `NODE_SECRET` and `TRUNK1..4_*` (a 4th subaccount was added mid-session) are
set in App Platform and deployed; `powerotp-agent` on `powerotpvoip1` was redeployed
twice this session (once for the trunk-pool/SMS-DID-pool refactor, once for the
voice_code pause fix), authenticates, fetches its flat trunk-pool config, renders
`pjsip_trunks.conf`, and successfully reloads Asterisk
(`"trunk configuration changed; reloaded pjsip"` in its logs). Deploy-time incidents and
their fixes (including one from this session — see "Live confirmation" under "Outbound
trunk pool" above for the schema-change/old-agent incompatibility) are recorded below so
they aren't re-discovered the hard way.

## Droplet deploy hardening (implemented)

Prompted by a reported "your droplet is doing SSH brute-force attacks" abuse notice that
turned out to be **a phishing email, not a real DigitalOcean report** (see the incident
note below). The forensic pass found no compromise, but it did surface real weaknesses in
the deploy path, which were fixed. Current shape:

- **CI no longer deploys as root.** A new unprivileged system user `potp-deploy` (primary
  group `asterisk`, home `/var/lib/potp-deploy`) owns `/opt/powerotp` and runs `npm ci` and
  the builds. Previously `.github/workflows/verify.yml` SSHed in **as root** on every push
  to `main` and ran `npm ci` there, which executes every dependency's `postinstall` script
  as root on the telephony node — one compromised npm package was a root RCE on the box,
  and `npm audit --omit=dev` in CI does not catch that.
- **The CI key can only do one thing.** `DROPLET_SSH_KEY` is pinned in
  `/var/lib/potp-deploy/.ssh/authorized_keys` with
  `command="/usr/local/bin/potp-deploy",restrict`. That program is
  `infrastructure/asterisk/potp-deploy` in this repo; it reads the `git archive` tarball on
  **stdin** (which is why the workflow has no `scp` step any more — an unrestricted key is
  needed for `scp`, and a forced command blocks it). A leaked `DROPLET_SSH_KEY` therefore
  cannot open a shell, run another command, or read `/etc/powerotp/*.env`. Verified by
  asking the key to run `id` and watching the deploy entrypoint run instead.
- **The one privileged step is granted as two exact commands**, in
  `/etc/sudoers.d/potp-deploy`: `systemctl restart powerotp-agent` and
  `systemctl is-active powerotp-agent`. No wildcards, no `ALL`. No root `chown` is needed
  after extraction because `potp-deploy`'s primary group is `asterisk` and the deploy
  entrypoint runs with `umask 027`, so built files are group-readable by `potp-agent`.
- **Separate keys per purpose.** CI has its own ed25519 keypair, distinct from the human
  `~/.ssh/poweroTP_do_droplet` key. Previously one private key was simultaneously root on
  the droplet, the `DROPLET_SSH_KEY` repo secret, and a file on the developer laptop.
- **Root SSH login is closed.** `/etc/ssh/sshd_config.d/10-powerotp-hardening.conf` sets
  `PermitRootLogin no`, `AllowUsers opsadmin potp-deploy`,
  `AuthenticationMethods publickey`, `MaxAuthTries 3`, `LoginGraceTime 20`, and disables
  agent/TCP forwarding, tunnelling, and X11. It is named `10-` deliberately: sshd keeps the
  **first** value it sees for a keyword and the cloud-init drop-ins are `50-`/`60-`.
  Human access is `ssh powerotp` → `opsadmin` → `sudo`.
- **Egress is restricted and logged.** `ufw` still defaults to allow-outgoing, but explicit
  `deny out` rules now cover `22`, `23`, `25`, `445`, `465`, `587`, `3389/tcp`
  (comment `egress-abuse-guard`), so the node cannot make the outbound SSH/SMTP/RDP
  connections an abuse bot would — the exact behavior the phishing mail alleged is now
  structurally impossible, and attempts are logged. Nothing legitimate needs these: the
  agent talks HTTPS to the control plane and SIP over UDP, and email goes through Brevo's
  API from `frontend`, never SMTP from the droplet.
- **IAX2 removed.** `chan_iax2` was loaded and listening on `udp/4569` with Asterisk's
  packaged anonymous `[guest]` user in `iax.conf`, despite IAX2 being completely unused
  (`iax2 show peers`/`show registry`: zero of each — all trunks are PJSIP). Added
  `noload => chan_iax2.so` to `/etc/asterisk/modules.conf` and unloaded it at runtime
  (`module unload chan_iax2.so`), which removes the listener without an Asterisk restart,
  so trunk registrations were never dropped.
- **Deliberately not changed**: the PJSIP transport still binds `0.0.0.0:5060`. `ufw`
  already denies all inbound on it, and the repo's own
  `infrastructure/asterisk/pjsip-transport.conf` documents how easily registrations break
  when that transport is edited — rebinding it would have been risk without a security
  gain. Do not "harden" this without a reason.
- **CI host-key pinning**: the workflow used `ssh-keyscan` into `known_hosts` and then set
  `StrictHostKeyChecking=yes`, which is decorative — trust-on-first-use on a fresh public
  runner accepts whatever key it is handed, every run. There is now a
  `DROPLET_SSH_HOST_KEY` repo secret holding the pinned `known_hosts` line instead.

Repo secrets after this pass: `DROPLET_HOST` (unchanged), `DROPLET_SSH_USER`
(now `potp-deploy`), `DROPLET_SSH_KEY` (new, restricted key), `DROPLET_SSH_HOST_KEY`
(new).

## Node rebuild / disaster recovery (implemented)

Until this session the droplet was a **single point of failure held together by
undocumented local state**: the runbook in `infrastructure/asterisk/README.md`
described provisioning in prose, but the actual Asterisk/SSH/firewall
configuration existed only on that one machine. Losing it, or needing to move to
a new IP, meant rediscovering all of it. That is fixed — everything needed to
rebuild is now committed, and the rebuild is one script.

`infrastructure/asterisk/bootstrap-node.sh` takes a stock Ubuntu 24.04 droplet
to the exact shape `powerotpvoip1` is in, and is idempotent (so it also repairs a
drifted node). Committed alongside it, each installed to its real path by the
script:

| Repo file | Installed as |
| --- | --- |
| `bootstrap-node.sh` | (run once, not installed) |
| `powerotp-agent.service` | `/etc/systemd/system/powerotp-agent.service` |
| `asterisk.service.d-override.conf` | `/etc/systemd/system/asterisk.service.d/override.conf` |
| `pjsip-transport.conf` | appended to `/etc/asterisk/pjsip.conf` |
| `potp-deploy` | `/usr/local/bin/potp-deploy` |
| `sudoers-potp-deploy` | `/etc/sudoers.d/potp-deploy` |
| `sshd-hardening.conf` | `/etc/ssh/sshd_config.d/10-powerotp-hardening.conf` |

The script additionally generates the small inline pieces that are appended to
packaged config rather than replacing it: ARI/HTTP enablement bound to
`127.0.0.1`, the `[powerotp-outbound]` placeholder dialplan context,
`noload => chan_iax2.so`, the `ufw` inbound/egress rules, swap, and the three
accounts.

**Deliberately not committed: the secrets.** A rebuild re-supplies `NODE_SECRET`
and `MEDIA_MANIFEST_SECRET` (both from App Platform, both identical across
nodes), plus the two SSH public keys. The ARI password is *not* re-supplied — the
script generates a fresh one per node, and the control plane neither needs nor
stores it. Trunk credentials need no manual step at all: they arrive from
`GET /v1/nodes/config` on the first poll, which is the whole point of the
"a droplet is never individually configured" design.

### Redeploying on a new IP — the IP-dependent checklist

`bootstrap-node.sh` prints this on completion, repeated here because it is the
part that actually bites:

1. **`DROPLET_HOST`** repo secret → the new IP.
2. **`DROPLET_SSH_HOST_KEY`** repo secret → the *new* host key. A rebuilt droplet
   has a brand-new host key, so the pinned line must be regenerated
   (`ssh-keyscan -t ed25519 <new-ip>`, cross-checked against the box's own
   `/etc/ssh/ssh_host_ed25519_key.pub` before trusting it). Skipping this fails
   the deploy closed rather than open, which is the intended behavior.
3. **DNS `na1.powerotp.com`** → repoint at the new IP.
4. **Local `~/.ssh/config`** `powerotp` alias → new `HostName` (and `User
   opsadmin`). This file is local-only and does not sync.
5. **VoIP.ms** → if the subaccounts are restricted by source IP, add the new one.
   Registration is outbound so this may not apply, but it is the one dependency
   outside our control.
6. **This document** → the IP recorded above.

**Open recommendation: attach a DigitalOcean Reserved IP.** The droplet currently
has none (`floating_ip/ipv4/active` reports `false`; region `tor1`), which is why
a rebuild drags all six steps above with it. With a Reserved IP, a rebuild keeps
the same address and steps 1–5 collapse to nothing. This has not been done — it
needs a DigitalOcean control-panel action and this environment has no DO API
access.

**Confirmed while taking this inventory:** the live droplet's
`/etc/powerotp/agent.env` contains only `CONTROL_PLANE_URL`,
`ASTERISK_PJSIP_TRUNKS_PATH`, `POLL_INTERVAL_MS`, and `NODE_SECRET` — no
`MEDIA_MANIFEST_SECRET` or `MEDIA_ROOT`, so `media-sync.ts`'s loop has never run
on `powerotpvoip1`. This is **correct for the current state**, not an oversight
to fix on the droplet: DigitalOcean Spaces is still unprovisioned, so
`MEDIA_MANIFEST_SECRET` and the `SPACES_*` values are unset in App Platform as
well, and `voice_challenge` fails closed end-to-end by design (see "Infrastructure
that has real credentials behind it" above). Setting the two droplet vars alone
would accomplish nothing — there would be no manifest to fetch. They become
required at the same moment Spaces is provisioned, which is why
`bootstrap-node.sh` wires both automatically whenever `MEDIA_MANIFEST_SECRET` is
supplied to it.

### Incident: a phishing email impersonating a DigitalOcean abuse report

A message claiming `powerotpvoip1` was compromised and performing SSH brute-force attacks
turned out to be phishing — there was no matching ticket in the DigitalOcean control
panel, and no link in it was clicked. Recorded here because the forensic pass is the
reusable part, and because "the droplet is clean" should not have to be re-derived from
scratch next time:

- The droplet was created 2026-08-05 12:45 UTC (cloud-init first boot, instance
  `590153452`), so its logs cover its entire life with no gap.
- `sysstat` collects 10-minute network samples continuously. Peak **outbound** rate on
  every single day was 2–10 packets/s, except one 210 packets/s sample at 05:35:41 on
  Aug 7 — the exact second the kernel OOM-killed `npm ci` (the swap incident below).
  Lifetime average was ~2.6 packets/s outbound. Sustained brute-forcing would be orders of
  magnitude higher, so the alleged behavior demonstrably never happened.
- Root had no `~/.ssh/known_hosts` and no `~/.bash_history` at all — the box had never
  made an outbound SSH connection.
- Every accepted SSH login in the droplet's history was the one expected ed25519 key, from
  either Azure ranges (the GitHub Actions deploy job) or the operator's ISP. `fail2ban`
  showed 5,381 failed attempts and 378 bans, all inbound background noise, none successful.
- Clean on: cron/`at`, systemd units and timers, `/tmp`, `/var/tmp`, `/dev/shm`,
  `/etc/ld.so.preload`, the SUID set, `dpkg -V` on core packages, out-of-tree kernel
  modules, and hidden processes (`/proc` PID count matched `ps` exactly).
- **Useful for next time**: the fastest disproof of an outbound-abuse claim on this box is
  `sar -n DEV -f /var/log/sysstat/sa<DD>` for peak `txpck/s`, plus the absence of
  `/root/.ssh/known_hosts`.

### Incident: empty-string optional env vars crashed the whole app

Setting `NODE_SECRET` in App Platform briefly took the entire site down (`/health`,
`/`, everything — 500 from three independent network paths, not just the new node
route), even though DigitalOcean's own dashboard reported the deploy as healthy. Root
cause: App Platform lets an operator create an env var with a blank value instead of
omitting it, which `ProductionConfigSchema` treated as invalid for optional fields — and
because `instrumentation.ts` calls `loadConfig()` eagerly at boot to fail fast on bad
config (by design), one blank optional variable crashed the entire process, not just the
feature it was for. Fixed in `backend/packages/api/src/config.ts#loadConfig`: empty-string values are
now filtered out before parsing, so "unset" and "set to blank" are equivalent for
optional fields, while a required field left empty still correctly fails fast. Covered by
`backend/packages/api/src/config.test.ts`. If a future deploy goes fully dark again (every route,
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

## Provider cost reconciliation (implemented; customer billing/balance not yet built)

The platform needed its own record of what every call/SMS actually costs and
how long it took, pulled from VoIP.ms's own records rather than trusted
solely to Asterisk/agent-side reporting — the user's own framing: capture
"the Asterisk version of events" immediately, then "the VoIP.ms version"
minutes later, both saved on the one row that already represents that OTP
transaction (`verificationRequests` — deliberately **not** a separate
join table; the user was explicit that a single table backing every
customer/admin report is the design goal, so this only ever adds fields to
the existing document, never a new collection).

- **What's captured immediately (the "Asterisk version")**: which trunk
  (`callTrunkId`, e.g. `trunk-1`) or SMS DID (`smsDid`) actually carried
  out the delivery attempt. For calls this is reported by the telephony
  node itself — `NodeJobEventSchema` gained an optional `trunkId`,
  populated from `apps/telephony-agent/src/job-poller.ts#runJobWithFailover`'s
  return value (whichever trunk produced the final outcome, not an
  earlier failed-over attempt) — and recorded via
  `VerificationService#recordProviderAttemptMeta` before the corresponding
  state transition is applied (`backend/apps/server/app/v1/nodes/jobs/[interactionId]/events/route.ts`).
  For `sms_code`, `backend/packages/api/src/sms.ts#createVoipMsSmsService`'s
  `sendVerificationCode` now returns `{ did }` on success (only on
  success — a DID that was tried and rejected before a working one is
  never recorded, since it was never actually used/billed), threaded
  through `TransportHandle#advance`'s new optional third `meta` argument
  (`backend/packages/api/src/transport.ts`, wired in
  `backend/packages/api/src/verification-queue.ts#createDispatchWorker`). The existing
  per-transition timeline in `verificationEvents` (already timestamped)
  remains the record of state-change timing; nothing new was needed there.
- **What's captured minutes later (the "VoIP.ms version")**:
  `VerificationService#transition` schedules a delayed reconciliation job
  (`backend/packages/api/src/provider-reconcile-worker.ts`, queue
  `verification-provider-reconcile`) the *first* time an interaction
  crosses into "delivery is done" — expressed generically as
  `!hasReachedAwaitingResponse(current.type, current.state) &&
  hasReachedAwaitingResponse(updated.type, updated.state)`, which fires
  exactly once per interaction regardless of type (works for
  `call_reachability`, which has no `awaiting_response` state at all, and
  for `voice_code`/`voice_challenge`/`sms_code`, without re-firing on the
  customer's own later code/challenge submission) — and only when a real
  trunk/DID was actually recorded (skipped entirely for
  `method_not_available`, since nothing was ever attempted).
  `backend/packages/api/src/provider-reconcile-service.ts` then queries VoIP.ms's
  `getCDR` (voice) or `getSMS` (`sms_code`) for a ±1-day window around the
  interaction's `createdAt` (VoIP.ms's own date filters are day-granularity,
  not datetime) and matches the closest-in-time row whose destination/
  contact number matches (suffix-tolerant, to survive `+1`/no-`+1`
  formatting differences) — narrowed further by VoIP.ms account name (the
  trunk's own `TRUNKn_USER`) for calls, where available. A match is stored
  as `providerRecord` (`{ source, fetchedAt, durationSeconds?,
  providerCostUsd?, raw }` — `raw` is the *entire* unmodified VoIP.ms row,
  kept regardless, purely so nothing is lost if VoIP.ms ever adds/renames a
  field). Field names (`destination`, `account`, `seconds`, `total`, etc.
  for `getCDR`; `contact`, `type`, `date` for `getSMS`) are **not
  guessed** — they're VoIP.ms's own confirmed, real response schema,
  sourced from VoIP.ms's official API documentation
  (`https://voip.ms/m/apidocs.php`) and cross-checked against real captured
  example values in the open-source `ecliptical/voip-ms` Rust client's
  `tools/api-responses.json` and its published `GetCDRResponseCDR`/
  `GetSMSResponseSMS` types — see the `VoipMsCdrRow`/`VoipMsSmsRow`
  interfaces and their doc comments in
  `backend/packages/api/src/provider-reconcile-service.ts` for the full confirmed
  shape and citations. `sms_code`'s cost is **not** read from `getSMS` (VoIP.ms
  doesn't return a per-message cost there) — it's `SMS_OUTBOUND_RATE_USD`
  (`$0.0075`, VoIP.ms's own published flat rate, a constant to update by
  hand if VoIP.ms's rate ever changes) applied whenever a real send is
  matched. No new credentials were needed — `getCDR`/`getSMS` are called
  with the same account-wide `VOIPMS_SMS_API_USERNAME`/
  `VOIPMS_SMS_API_PASSWORD` REST credentials `sms_code` already uses (the
  new low-level POST helper, `backend/packages/api/src/voipms-http.ts`, is also a
  dedup of `sms.ts`'s previously-inline `multipart/form-data` POST logic —
  behavior-preserving, same log lines, same live-confirmed
  `multipart/form-data`-not-urlencoded quirk, just shared with the new
  `backend/packages/api/src/voipms-billing-client.ts`).
- **Retry/give-up policy**: VoIP.ms's own CDR/SMS logs are not guaranteed
  to be queryable the instant a call/message finishes, so a "no match yet"
  result is retried via BullMQ's backoff (5 attempts, fixed 2-minute delay,
  after an initial 3-minute delay before the first attempt) rather than
  failing immediately; only on the final attempt is
  `providerRecordStatus` set to a terminal `"not_found"` (or `"error"` if
  the lookup itself kept failing, e.g. bad credentials or a VoIP.ms
  outage — kept distinct from `"not_found"` so the two failure modes
  aren't confused later). `"pending"` is set the moment reconciliation is
  scheduled so a document's state is always inspectable mid-flight.
- **Confirmed live** (this session, against real VoIP.ms `getCDR`/`getSMS`,
  canary destination `+14034701805`): a `call_reachability`, a `voice_code`,
  and an `sms_code` demo verification were placed in the same run.
  All three reached `providerRecordStatus: "matched"` within one reconcile
  cycle (no `not_found` retries needed) with the exact real, non-guessed
  field names from the confirmed schema:
  - `call_reachability` (`trunk-1`, answered/hung-up immediately): matched
    a `getCDR` row with `durationSeconds: 1`, `providerCostUsd: 0.0009`
    (VoIP.ms `rate: 0.009`/min × 1s).
  - `voice_code` (`trunk-4`, real ~10s of code playback): matched a
    `getCDR` row with `durationSeconds: 10`, `providerCostUsd: 0.0018` —
    confirms duration/cost extraction is correct for a non-trivial call,
    not just an instant one.
  - `sms_code`: matched a `getSMS` row and applied the flat
    `SMS_OUTBOUND_RATE_USD` ($0.0075), confirming `getSMS` still carries no
    per-message cost field as expected.
  No field-name or extraction fix was needed — the schema sourced from
  VoIP.ms's official docs and the `ecliptical/voip-ms` client last session
  was correct on the first live attempt. This closes out the "not yet
  live-tested" gap noted below; the remaining open item in this area is
  purely the customer-facing balance-tiered billing rule, not this
  reconciliation mechanism itself.
- **Customer balance billing is now implemented** — see the new "Customer
  balance billing" section below for the full design.
  `providerRecord.providerCostUsd` (this platform's own real cost, captured
  here) and the customer-facing tiered price the balance-billing system
  charges are deliberately two separate numbers computed two separate ways
  (VoIP.ms's own CDR/SMS cost vs. an admin-entered rate-chart lookup) — the
  former is never used as a direct input to the latter, since the tiered
  price must be known immediately at charge time, long before VoIP.ms's own
  CDR reconciliation (which can take 10+ minutes) resolves.

## Customer balance billing (implemented)

Built after direct Q&A with the user scoped down the original balance-tiered
billing idea (see "Provider cost reconciliation" above) into something
concrete enough to build: admin-editable per-country rate charts (gathered
by hand from VoIP.ms's own published per-minute/per-message rates, never
fetched automatically), a per-tier monthly/daily plan fee, a real,
transactional running-balance ledger, and Stripe fixed-amount top-ups.

- **Tiers** (a correction from the placeholder framing in the "Provider
  cost reconciliation" section above, which had the direction backwards):
  tier1 = balance $0–$49.99 (most expensive), tier2 = $50–$99.99, tier3 =
  $100+ (cheapest) — more money on deposit gets a better rate, the reverse
  of an earlier draft. The dollar boundaries are a fixed product decision
  (`backend/packages/api/src/balance-service.ts#tierForBalance`), not admin-configurable;
  only the *rates* charged per tier are.
- **Rate charts** (`backend/packages/api/src/rate-chart-service.ts`,
  `callRateCards`/`smsRateCards` collections, `_id` = ISO 3166-1 alpha-2
  country code): one row per country, three tier columns each, for calls
  (USD/minute, shared by `call_reachability`/`voice_code`/`voice_challenge`
  — a VoIP.ms per-minute cost doesn't depend on which OTP type placed the
  call) and SMS (USD/message, `sms_code`) separately. Edited via
  `GET/PUT /v1/admin/billing/call-rates` and `.../sms-rates` and rendered
  as editable grids in `frontend/app/admin/billing-rates-panel.tsx`. A
  country with no rate entered yet bills $0, never a guessed default.
- **Plan charge chart** (`planCharges` collection, exactly 3 documents):
  `monthlyDisplayUsd` (the "$10/month" a customer sees) and
  `dailyChargedUsd` (what is actually deducted once/day) are two
  independently admin-entered numbers, never one derived from the other —
  matching the user's own framing ("we show it as a monthly $10 ... charged
  daily"). Edited via `GET/PUT /v1/admin/billing/plan-charges`.
- **The ledger** (`financialTransactions` collection, append-only, no TTL —
  a permanent financial record, unlike the 18-month-TTL'd verification
  collections): one row per balance-affecting event —
  `userId`/`projectId`/`interactionId`/`stripePaymentId` (whichever apply),
  `type` (`otp1`..`otp4` map 1:1 to
  `call_reachability`/`voice_code`/`voice_challenge`/`sms_code` via
  `otpChargeTypeFor` in `backend/packages/contracts/src/billing.ts`;
  `daily_charge`; `topup`; `visit` is reserved but unused, see below),
  `country` where applicable, and `openingBalanceUsd`/`tierAtTransaction`/
  `amountUsd`/`closingBalanceUsd` — every row carries its own before/after
  balance, so any date-range total is independently verifiable without
  recomputing anything. A materialized `customerBalances` cache
  (`{ _id: userId, balanceUsd, tier }`) is always written in the same
  MongoDB multi-document transaction as the ledger insert
  (`backend/packages/api/src/balance-service.ts#applyLedgerEntry`, using
  `client.startSession()` — Atlas is always a replica set, so real
  transactions are always available), so concurrent charges/credits can
  never corrupt the running balance. A tier-dependent charge amount is
  resolved *inside* that same transaction (an `amountUsd` resolver function
  given the opening tier), not computed ahead of time, so a concurrent
  top-up can't leave a charge using a stale tier.
- **Charge trigger**: `VerificationService#transition` calls
  `BillingChargeService#chargeCompletedInteraction`
  (`backend/packages/api/src/billing-charge-service.ts`) at the exact same moment
  provider-cost reconciliation is already scheduled from — the first time
  an interaction crosses into "delivery is done" — never waiting on
  VoIP.ms's own CDR reconciliation. Billed quantity comes from **this
  platform's own** event timeline, never a guessed provider field:
  - Calls: `computeBillableMinutes` finds the interaction's own `answered`
    event and its terminal event, bills `ceil(seconds / 60)` with a
    1-minute minimum once answered — a busy/no-answer/rejected call that
    never answered bills $0, matching real telephony billing norms.
  - SMS: a flat 1-message charge whenever a real send was accepted by
    VoIP.ms (`smsDid` recorded), regardless of confirmed delivery.
  - Country is resolved from the interaction's own E.164 `targetNumber` via
    `backend/packages/api/src/country-lookup.ts` (`libphonenumber-js`, a real
    maintained library) — deliberately not a hand-rolled calling-code
    prefix table, which would misattribute countries that share one (e.g.
    NANP's `+1`: this project's own real canary number, `+14034701805`,
    is actually Canadian, not American).
  - Never charged for the platform-admin-owned demo project
    (`PLATFORM_ADMIN_USER_ID`, `backend/packages/api/src/persistence.ts`) —
    `applyLedgerEntry`/`requireNonNegativeBalance` both exempt it, since
    there is no real customer balance behind the public marketing demo.
- **Insufficient balance**: `VerificationService#create` calls
  `BalanceService#requireNonNegativeBalance` before creating any new
  interaction — a hard `balance <= 0` gate (`insufficient_balance`, HTTP
  402), not a per-call cost pre-estimate (real cost isn't known until after
  the attempt completes). Applies uniformly to every creation path
  (customer-backend, the hosted modal, the demo — exempted as above).
- **Daily plan charge**: `backend/packages/api/src/billing-daily-charge-worker.ts`, a
  BullMQ repeatable job (`billing-daily-charges` queue, once/day) charges
  every *active project* ("website install"/card) its owning customer's
  current-tier `dailyChargedUsd` — one row per project per day, not one per
  customer account. Per-project idempotency is a direct query ("does a
  `daily_charge` row already exist for this project since the start of
  today, UTC?"), not just the repeatable job's stable `jobId` — a mid-tick
  restart re-running the same calendar day's pass can never double-charge
  an already-charged project.
- **Stripe top-ups** (`backend/packages/api/src/stripe-service.ts`): fixed amounts only
  — $5/$25/$50/$100, no arbitrary custom amount.
  `POST /v1/billing/topups` (customer session-gated) creates a Stripe
  Checkout session; the actual credit is only ever applied from
  `POST /v1/billing/stripe/webhook` (public, authenticated entirely by
  Stripe's own request signature) on a `checkout.session.completed` event —
  never from the session-creation response itself, since the customer might
  never complete payment. A `processedStripeEvents` collection (keyed by
  Stripe's own event id, 90-day TTL) makes the webhook idempotent, since
  Stripe retries on any non-2xx response. New optional config:
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — both empty-string-is-unset
  like every other optional var; fails closed with `billing_not_configured`
  until both are set, same deferred-credential convention as every other
  provider in this project. **Not live-tested this session** — no real
  Stripe test-mode keys were provided; ships code-complete and unit-tested
  (webhook signature verification and idempotency are tested against a real
  `Stripe` SDK instance with a dummy key, since signature verification is a
  local HMAC check with no network call — only the actual Checkout-session
  creation network call is untested, consistent with how this project never
  unit-tests other live provider calls like VoIP.ms's `sendSMS`).
- **Customer/admin visibility**: `GET /v1/billing/balance` and
  `GET /v1/billing/ledger` (customer session-gated, own data only) back a
  new dashboard section (`frontend/app/dashboard/billing-panel.tsx`) showing
  balance/tier, the 4 top-up buttons, and a recent-ledger table.
  `GET /v1/admin/billing/ledger?userId=` (admin-only) backs
  `frontend/app/admin/billing-ledger-panel.tsx`, a manual look-up-by-user-id
  panel for support, same convention as every other admin panel.
- **Deliberately deferred, explicitly scoped down through this session's
  Q&A rather than guessed at** — the "visit" ledger type is reserved in
  `backend/packages/contracts/src/billing.ts`'s type enum but has **no real
  charging logic wired to it**: it belongs to the future BotBlocker/
  gate-adapter product (`docs/POWEROTP_BOTBLOCKER_PLAN.md`), which does not
  exist yet. The user's own described rule for that future product,
  recorded verbatim here so it isn't lost: *"when they hit 100,000 visitors
  in the calendar month we charge another 100k amount to the account for
  the tier they are at when they have the 100,001 visitor — each visit
  count is when the gateway is hit and sends that signal to our backend
  with the visitor behavior tracking (IP, mouse actions, click behavior,
  browser type, etc., all coming from each visitor and pages
  clicked/time on page/what was clicked, built into the middleware)."* Do
  not build any part of this until the BotBlocker gate-adapter itself
  exists to actually emit that signal.

## Customer signup flow (implemented)

Built to close the real gap the "Customer balance billing" work above left
open: with no signup flow, no real customer could ever get a balance above
$0, and the new `insufficient_balance` gate would block every real request.
Scoped down through direct Q&A (the same standing pattern as billing) before
any code was written — the original quota framing shifted from a dollar
credit to a plain usage counter mid-session once the user pointed out the
dollar-credit design (a monthly BullMQ worker) was needless complexity for
what is really just "give new accounts a free allowance, then charge
normally."

- **Password pepper**: `PASSWORD_PEPPER` (required, ≥32 bytes, independent
  from every other secret) is mixed into every customer password hash via
  Argon2's own `secret` option (`backend/packages/api/src/security.ts#hashPassword`/
  `verifyPassword`) — true keyed hashing, not string concatenation. Never
  stored anywhere near the hash (unlike Argon2's own per-hash salt), so a
  leaked `users` collection alone is never enough to offline-crack
  passwords. Safe to introduce as a newly-required env var with zero
  migration concern — there were no real customer accounts yet this
  session.
- **Password rules**: `PasswordSchema` (`backend/packages/contracts/src/auth.ts`)
  gained a special-character requirement (12+ chars, upper, lower, digit,
  special — all five, per the user's exact framing). The same five rules
  are also exported as `PASSWORD_REQUIREMENTS` (an array of
  `{ id, label, test }` predicates) so the signup modal's live checklist UI
  and the server-side Zod schema can never silently drift apart.
- **The rapid signup modal** (`frontend/app/signup-modal.tsx`, triggered from
  a "Sign up" nav link and the homepage hero CTA via
  `frontend/app/signup-cta.tsx`): one modal collects email, password (typed
  twice, with the live checklist above) — then, on submit, creates the
  account **and** its first project/API key together,
  showing the raw API key once directly in the same modal with the note
  "This key is shown once — copy it to a safe place. Your API key will work
  immediately on the free tier upon pressing the activation link in your
  email" (the account must still click that link before the key can create
  anything real — see "Email-verification gate" below). `POST
  /v1/auth/signup` (`SignupSchema`/`SignupResponseSchema` in
  `backend/packages/contracts/src/auth.ts`) does this in one request:
  `AuthService#register` (unchanged core logic, now returns `{ userId,
  alreadyVerified }` instead of `void` so the route can act on it) followed
  by `ProjectService#create` using the neutral name `My Project`, no allowed
  website origins, and every verification method enabled by default.
  Website ownership is not an account-creation requirement: each dashboard
  project card lets the customer add, replace, or clear its optional HTTPS
  browser/widget origins later through the existing authenticated project
  update endpoint. A resubmission of an
  already-unverified email reuses the existing project (never fabricates a
  second API key — the first one was already shown once and is
  non-recoverable); an already-verified email returns a generic
  `already_registered` status with no project/key data at all
  (anti-enumeration, matching the existing `register()` behavior). The
  original `/register` page/`POST /v1/auth/register` endpoint (password
  only, no project/key, "check your email" outcome) is untouched and still
  works as a plain fallback — nothing was removed.
- **Email-verification gate** (`AuthService#requireVerifiedEmail`, injected
  into `VerificationService#create` the same way as
  `requireNonNegativeBalance`): blocks creating *any* new verification
  interaction (`email_not_verified`, HTTP 403) until the account's email is
  verified. This closes a real abuse gap the signup modal's "immediate API
  key" design would otherwise open: without it, a freshly registered but
  never-verified account could still spend its entire free monthly quota
  (below) purely by holding the key shown once at signup, never clicking
  the activation link at all. Exempts the platform-admin-owned demo
  project, like every other per-customer gate in this codebase.
- **Free monthly usage quota** (`backend/packages/api/src/usage-quota-service.ts`,
  `UsageQuotaService`, `usageQuotas` collection) — checked *before*
  `BalanceService#requireNonNegativeBalance` inside
  `VerificationService#create`; a request it covers never touches the
  balance gate at all. It is a plain rolling counter, never a dollar credit
  (a dollar-credit design with its own monthly BullMQ worker was drafted and
  then deliberately discarded mid-session as needless complexity for this —
  "give the free quota a counter then start charges"). The interaction still
  gets a real row in the same `financialTransactions` ledger at completion,
  always at `amountUsd: 0` with `note: "free_quota"` (`otp1`..`otp4`, set via
  `VerificationRequestDocument#freeQuotaCovered`, fixed at creation time and
  read by `BillingChargeService#chargeCompletedInteraction`) — per explicit
  instruction, free usage must be fully visible in every report/UI a real
  charge appears in (the customer dashboard's ledger table, the admin ledger
  lookup panel), not silently invisible. Per account, for its first 180 days
  since signup only:
  - `call_reachability`: 10 free per rolling 30-day window
  - `voice_code`: 10 free per rolling 30-day window
  - `sms_code`: 5 free per rolling 30-day window
  - `voice_challenge`: **no free quota at all** — always goes straight to
    normal balance-gated charging, an explicit product decision, not an
    oversight.
  The 30-day window is rolling from account creation, not calendar-month
  (no cron alignment needed — `tryConsumeFreeQuota` just compares
  `now - windowStartAt` against 30 days and resets in place). Once the
  180-day eligibility window has passed (`eligibleUntil`, fixed once at
  first use as a fixed day count from the account's own `createdAt` — not
  "6 calendar months", which varies 28-31 days per month; checked on every
  call), or
  once a given 30-day window's quota for that type is already used up,
  every further request of that type falls through to the normal
  `requireNonNegativeBalance` gate (a plain `balance > 0` check for every
  type — see "No per-type minimum balance floor" below) — never blocked
  outright by quota exhaustion alone. Not a Mongo transaction: a small race
  window under
  concurrent requests could over-consume a slot by one, corrected by an
  increment-then-rollback check (`tryConsumeFreeQuota`) rather than a full
  transaction — acceptable since nothing here is money, unlike
  `BalanceService#applyLedgerEntry`, which does use a real transaction.
  A future 5th verification type — **email-based OTP, with its own
  proposed 1,000-free-per-30-days quota** — was raised in this session's
  scoping Q&A and explicitly deferred; see "Known gaps / next steps" below.
  Do not build it speculatively.
- **No per-type minimum balance floor**: a $0.30 minimum for
  `sms_code`/`voice_challenge` was tried and then deliberately removed in
  the same session — it doesn't make sense once an active project is
  charged the daily plan fee regardless of balance (see "Daily plan
  charge" above), and the free usage quota above, not a balance floor, is
  what actually protects a brand-new account. `requireNonNegativeBalance`
  is back to the original plain `balance > 0` gate for every type.
- **Data-minimization / SOC 2-oriented design**: most of the codebase never
  touches the one collection holding real customer PII/credentials
  (`users` — email, password hash) at all; it only ever passes a plain
  opaque `userId` around. `AuthService` is the only module that reads or
  writes `UserDocument` directly (login, registration, session,
  `requireVerifiedEmail`). Every other service that needs *something* about
  an account — `UsageQuotaService`, for a signup timestamp to seed a new
  quota window's eligibility — reads the separate, deliberately PII-free
  `customerAccounts` collection (`CustomerAccountDocument`, just `_id` +
  `createdAt`, `backend/packages/api/src/persistence.ts`) instead. `BalanceService`
  never reads any account document at all — it only ever takes a `userId`.
  This was reinforced directly this session (the user's own framing: "use
  the client user id in our system to process things and not refer to user
  doc unless must") and is a genuinely useful SOC 2 posture regardless of
  formal certification — it minimizes how much of the codebase can even
  read PII, which is the property an auditor actually checks for.
- **Email encrypted at rest, looked up by a separate deterministic hash**:
  `UserDocument#email` (plaintext) was replaced with `emailEncrypted`
  (authenticated-encrypted under the new `PII_ENCRYPTION_KEY`, same
  primitive as `ProjectDocument#callbackSecretEncrypted`) and
  `emailLookupHash` (a deterministic HMAC under the new
  `EMAIL_LOOKUP_HASH_SECRET`) — a real DB dump of `users` never shows an
  actual email address. `emailLookupHash` is the collection's unique index
  and the only field `AuthService#register`/`loginCustomer` ever query by;
  `emailEncrypted` is decrypted only transiently, via the exported
  `AuthService#decryptEmail` helper, in exactly two places: sending the
  verification email (`AuthService#register`, which already has the
  plaintext from the request body, never round-trips through the DB for
  this) and `backend/apps/server/lib/session-cookies.ts#sessionUser`, which returns it
  to the account itself in a session response. Two independent new secrets
  by design — a leak of either one alone should never compromise the
  other (encryption vs. lookup-indexing are different concerns, matching
  every other secret-separation decision already in this codebase). The
  platform admin's `UserDocument` (upserted by `AuthService#loginAdmin`)
  uses the exact same encrypted/hashed shape for consistency, even though
  `ADMIN_EMAIL` itself is already a non-secret App Platform config value.
- **Brevo email template support** (`backend/packages/api/src/email.ts`): the account
  verification email can now use a Brevo dashboard template
  (`templateId` + `params.VERIFY_URL`) instead of the original inline HTML,
  selected by the new optional `POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID` env var
  (named after what it is, not the provider, so it reads unambiguously next
  to any future per-customer branded OTP-delivery template id) — unset
  keeps the original inline-HTML behavior working exactly as before, so
  this is purely additive. The HTML to paste into a new Brevo template
  (Campaigns → Templates → create, then use the template's own merge-tag
  editor) is:

  ```html
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <p style="font-size: 20px; font-weight: 800; color: #10241b; margin: 0 0 24px;">POWEROTP</p>
    <h1 style="font-size: 24px; margin: 0 0 12px;">Verify your email</h1>
    <p style="color: #55645d; line-height: 1.6;">
      Click the button below to activate your POWEROTP account and your API key.
      This link expires in one hour.
    </p>
    <p style="margin: 28px 0;">
      <a href="{{ params.VERIFY_URL }}" style="background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 700; padding: 14px 28px; border-radius: 8px; display: inline-block;">
        Verify email
      </a>
    </p>
    <p style="color: #92a099; font-size: 13px;">
      If the button doesn't work, paste this link into your browser:<br />
      <a href="{{ params.VERIFY_URL }}" style="color: #16a34a;">{{ params.VERIFY_URL }}</a>
    </p>
  </div>
  ```

  Name the template itself something obvious in the Brevo dashboard too
  (e.g. "POWEROTP - Sign Up Email Template"), since a future per-customer
  branded OTP-delivery template will live alongside it there. After
  creating the template, note its numeric Brevo template id and set it as
  `POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID` in App Platform (see
  [`infrastructure/app-platform/README.md`](../infrastructure/app-platform/README.md)).
- **Admin manual balance credit/debit** (`POST /v1/admin/billing/credit`,
  `frontend/app/admin/billing-ledger-panel.tsx`'s new "Manually credit/debit
  this user" form): the only way to adjust a customer's balance today
  outside of the automated top-up/charge paths — built specifically to
  close the "no mitigation exists" gap flagged at the end of the prior
  session (a real customer blocked by `insufficient_balance` before rates/
  Stripe were configured had no remediation short of editing Mongo
  directly). Writes a new `admin_adjustment` ledger type (added to
  `financialTransactionTypes` in `backend/packages/contracts/src/billing.ts`)
  through the same `BalanceService#applyLedgerEntry` transaction as every
  other ledger row, with a new optional `note` field (only ever populated
  for this type) recording the admin's stated reason. `AdjustBalanceSchema`
  takes a signed `amountUsd` (positive credits, negative debits).
- **Dashboard balance auto-refresh** (`frontend/app/dashboard/billing-panel.tsx`):
  polls `/v1/billing/balance` and `/v1/billing/ledger` every 10 seconds
  while the dashboard is open, so a Stripe-webhook-applied top-up credit
  (which lands asynchronously, slightly after the customer's browser is
  already redirected back by `frontend/app/top-banner.tsx`) becomes visible
  without a manual page refresh. Deliberately different from every admin
  panel's "manual refresh only" convention — this one is customer-facing and
  the whole point is reflecting an async webhook credit promptly.

## Email verification type, customer branding, and dashboard redesign (implemented)

Picked up as the next item in "Known gaps / next steps" (the deferred 5th
verification type) plus two related asks from the same session: a
customer-brandable delivery template for it, and a customer dashboard
redesign so every verification type — including the new one — has its own
settings and filtered history view.

- **`email_code`, a 5th verification type**: added to `verificationTypes`
  (`backend/packages/contracts/src/verification.ts`) alongside
  `call_reachability`/`voice_code`/`voice_challenge`/`sms_code`. Its state
  machine is identical to `sms_code`'s (`queued → dispatching →
  awaiting_response → succeeded|failed|expired|canceled` — see
  `backend/packages/api/src/verification-state-machine.ts`): a five-digit code is
  always platform-generated (never client-supplied, same as `sms_code`) and
  validated through the exact same `POST
  /v1/verifications/{interactionId}/response` route every other code-based
  type already uses (`VerificationService#submitCode` now accepts
  `email_code` alongside `voice_code`/`sms_code`).
- **The destination is still called `targetNumber`**, even though for
  `email_code` it holds an email address, not an E.164 number — deliberately
  kept as one generic "destination" field shared by every type
  (`CreateVerificationSchema`, `VerificationRequestDocument`) rather than
  adding a second `targetEmail` field, so masking, reporting, and the
  dispatch transport can keep treating "the destination" as one string
  regardless of type. `CreateVerificationSchema`'s `superRefine` now
  validates it as an email address for `email_code` and E.164 for every
  other type. `backend/packages/api/src/masking.ts` gained `maskEmail`/`maskTarget` (a
  type-aware dispatcher) so interaction summaries and widget-interaction
  rows mask an email address (`j•••••@example.com`) instead of running
  E.164 masking against it.
- **Delivery transport** (`backend/packages/api/src/email-otp-service.ts`,
  `createBrevoEmailOtpService`, wired into
  `backend/packages/api/src/transport.ts#createEmailCodeTransport`): sends the code over
  the same Brevo account as account-verification email, through its own
  dedicated module (not `backend/packages/api/src/email.ts`, which only ever sends the
  fixed signup-verification email and operator alerts) since every
  `email_code` send renders a different, per-project-branded template.
  Unlike `sms_code`'s VoIP.ms credentials, `BREVO_API_KEY`/`EMAIL_FROM` are
  both already-required config fields, so this transport has no "provider
  not configured" fallback state — it is always real once deployed.
- **Not offered through the hosted widget yet**:
  `ModalSessionVerificationRequestSchema` (`backend/packages/contracts/src/modal-sessions.ts`)
  still validates `targetNumber` as E.164-only, and
  `ModalSessionService#createSession` explicitly filters `email_code` out of
  any session's `allowedTypes` — reachable today only via a customer's own
  backend calling `POST /v1/projects/{slug}/verifications` directly.
  Extending the widget's own contact-input UI for email is a deliberate,
  documented scope cut, not an oversight.
- **Free quota and billing**: `email_code` gets its own free allowance in
  `backend/packages/api/src/usage-quota-service.ts` — **1,000 per rolling 30 days**, the
  user's own number from when this type was first scoped, same 180-day
  eligibility window as every other type. Once quota runs out, charging
  goes through a **new, deliberately flat, non-per-country rate** —
  `EmailRateSchema`/`EmailRateCardDocument` (`backend/packages/contracts/src/billing.ts`,
  `backend/packages/api/src/billing-persistence.ts`) is a single global document (fixed
  `_id: "global"`), not a per-country chart like
  `CallRateCardSchema`/`SmsRateCardSchema`, since Brevo's own per-email cost
  isn't country-dependent. Admin-editable at `GET`/`PUT
  /v1/admin/billing/email-rate` and a new card in `/admin`'s
  "Billing rates" panel (`frontend/app/admin/billing-rates-panel.tsx`), same
  "gathered and entered by an admin, never auto-fetched" convention as
  every other rate. Ledger type `otp5` was added to
  `financialTransactionTypes`, mapped 1:1 from `email_code` via
  `otpChargeTypeFor` — a free-quota-covered `email_code` interaction still
  writes a normal `otp5` row at `amountUsd: 0`/`note: "free_quota"`, same
  convention as every other type.
- **Customer-brandable delivery emails**: `ProjectDocument` gained optional
  `brandName`/`brandLogoUrl` fields (`backend/packages/api/src/persistence.ts`,
  `backend/packages/contracts/src/projects.ts`) — set by a customer for their own
  project, used *only* to brand that project's `email_code` delivery
  emails to their own end users (sender name, subject line, and an
  optional logo image), never anywhere else. Per an explicit multiple-choice
  answer this session, `brandLogoUrl` is a pasted link to an
  already-hosted image, not a file upload — DigitalOcean Spaces isn't
  provisioned for arbitrary customer-uploaded assets yet (it currently only
  holds `voice_challenge` recordings); revisit a real upload flow once it
  is. The branding is **snapshotted onto the interaction itself** at
  `create()` time (`VerificationRequestDocument#emailBranding`), the same
  "snapshot, never re-derive from a mutable source" rationale already used
  for `voice_challenge`'s own `challenge` snapshot — a customer changing
  their brand name/logo later can never change how an email already in
  flight looks.
- **Reply-to and a customer's own full HTML template** (added in a later
  same-topic session, after the user asked directly whether Brevo supports
  either): `ProjectDocument` gained two more optional branding fields,
  `brandReplyToEmail` and `brandHtmlTemplate`
  (`backend/packages/contracts/src/projects.ts`, `BrandReplyToEmailSchema`/
  `BrandHtmlTemplateSchema`). The "From" email address always stays our own
  verified `EMAIL_FROM` — Brevo (like every ESP) requires the sending
  domain to be authenticated in the account that sends, so we cannot send
  "From" an arbitrary customer's own domain without them individually
  verifying it in *our* Brevo account, which doesn't scale across many
  customers. `replyTo`, however, is completely independent of `sender` in
  Brevo's API and needs no verification at all, so `brandReplyToEmail` is
  the real, fully-supported way for an end user's reply to reach the
  customer directly (`backend/packages/api/src/email-otp-service.ts`, a `replyTo`
  field added to the Brevo API call only when set). `brandHtmlTemplate` is
  a customer's own complete HTML email body, pasted in as-is (max 20,000
  characters) — Zod-validated to contain the literal `{{CODE}}` placeholder
  (`BrandHtmlTemplateSchema`'s `refine`), substituted with the real
  one-time code at send time via a plain `replaceAll`, nothing else parsed
  or modified. When set, it replaces the auto-generated brand-name/logo
  template entirely. Deliberately never uses Brevo's own dashboard
  Templates feature at all — every `email_code` send (branded or not)
  already passes `htmlContent` directly in the API call, so a customer's
  HTML stays private to their own project in our database, never uploaded
  to Brevo's shared template library. Both new fields are included in the
  same per-interaction `emailBranding` snapshot as `brandName`/
  `brandLogoUrl` above, for the same reason.
- **Customer dashboard redesign**: each project card
  (`frontend/app/dashboard/project-card.tsx`) now renders
  `VerificationTabs` (`frontend/app/dashboard/verification-tabs.tsx`) instead
  of a flat method-chip list plus one always-unfiltered interaction
  timeline. One tab per verification type (including the new `email_code`)
  shows that type's own "enabled for this project" toggle (writing straight
  through the existing `PATCH /v1/projects/{id}` `enabledMethods` update)
  plus, for `email_code` only, the branding form above. Every type's tab
  then shows the *same* shared history table
  (`frontend/app/dashboard/interactions-table.tsx`, extracted from the old
  `InteractionTimeline`, now fed rows directly instead of owning its own
  fetch/show-hide state) filtered to just that type — `GET
  /v1/projects/{projectId}/interactions` gained an optional `?type=` query
  param (`backend/packages/api/src/verification-reporting.ts#listProjectInteractions`),
  validated against `VerificationTypeSchema` server-side. Per the user's
  exact framing: "tabs for each type ... settings for each and the table
  for each history ... same table all pages but filtered for the type."
- **A new "Visitors" tab** (`frontend/app/dashboard/visitors-panel.tsx`):
  the customer-facing equivalent of the admin-only widget-interactions
  panel, scoped to the caller's own project via a new `GET
  /v1/projects/{projectId}/visitors` route
  (`VerificationService#projectWidgetInteractions` →
  `verification-reporting.ts#listProjectWidgetInteractions`, the same
  `endUserIp`-exists filter as the admin-wide version, just `projectId`-
  scoped). Shows visit/unique-IP summary stats plus the interaction table
  with IP/User-Agent, and a **"Threat score" column that always reads
  "Coming soon"** — deliberately scaffolding only, per the user's explicit
  framing ("frame the table cards for this phase... most of which yet to
  build"). No scoring model, middleware signal ingestion beyond the existing
  bot-signal honeypot (`backend/packages/api/src/bot-signal-service.ts`, unchanged this
  session), or threat logic of any kind exists yet — this is UI framing for
  a future phase, not a real feature.
- **New unit tests** (all passing, `npm run verify` clean across every
  workspace): `backend/packages/api/src/email-otp-service.test.ts` (new — plain vs.
  branded template rendering, HTML-escapes an untrusted brand name,
  provider-rejected vs. provider-unavailable normalization),
  `backend/packages/api/src/transport.test.ts` (extended — `email_code`'s
  dispatch/failure/branding-passthrough behavior), `backend/packages/api/src/masking.test.ts`
  (extended — `maskEmail`/`maskTarget`), `backend/packages/api/src/usage-quota-service.test.ts`
  (extended — the 1,000/30-day `email_code` limit), `backend/packages/api/src/billing-charge-service.test.ts`
  (extended — flat-rate charging with no country, and the $0 case when no
  admin rate has been entered yet), `backend/packages/mcp/src/content.test.ts` (updated
  — now asserts 5 verification types, not 4), and (reply-to/custom-HTML
  addition) `backend/packages/api/src/email-otp-service.test.ts` (extended further —
  `replyTo` set only when branded, omitted otherwise, and `{{CODE}}`
  substitution into a customer's own HTML leaves everything else
  unmodified) and `backend/packages/contracts/src/index.test.ts` (extended —
  `email_code` target validation both directions, `BrandHtmlTemplateSchema`'s
  `{{CODE}}` requirement).

## Admin operator health dashboard (implemented)

`/admin` gained three read-only "operator health" additions, closing part of
Phase 7's "operator health views" item — deliberately kept minimal (no
auto-polling, no charts/history, no alerting) per an explicit scope check
during this session:

- **Node staleness badge**: purely client-side in
  `frontend/app/admin/page.tsx` — a node that hasn't polled `/v1/nodes/config`
  in more than `STALE_THRESHOLD_MS` (3x the agent's 60s default
  `POLL_INTERVAL_MS`) shows a "stale" badge instead of "live", computed from
  the same `lastSeenAt` the nodes panel already fetched. No backend change.
- **Trunk status** (the only real new backend capability): today's real SIP
  registration state (`pjsip show registrations`) was previously only
  visible over SSH, and `TrunkPool`'s call-outcome health/circuit-breaker
  state (see "Outbound trunk pool" above) lived entirely in the agent's
  memory, never reported anywhere. Both are now self-reported by the agent
  each trunk-config poll cycle (`POLL_INTERVAL_MS`, no new loop):
  - `apps/telephony-agent/src/pjsip-status.ts#currentPjsipRegistrations`
    shells out to `asterisk -rx "pjsip show registrations"` (same
    `execFile` pattern already used for `pjsip reload`) and parses each
    `trunk-N` row's real registration state
    (`Registered`/`Rejected`/`Unregistered`/`Unknown`) — the parser's test
    fixture is real captured CLI output from this project's own droplet,
    not a guessed format.
  - `apps/telephony-agent/src/trunk-pool.ts#snapshot` is a new read-only
    method (never mutates rotation/failover state) exposing each
    configured trunk's `healthy`/`consecutiveFailures`/`downUntil`.
  - `apps/telephony-agent/src/index.ts#syncOnce` combines both (matched by
    trunk id) and posts them via the new
    `apps/telephony-agent/src/control-plane-client.ts#reportTrunkStatus` to
    a new node-facing route, `POST /v1/nodes/trunk-status`
    (`backend/apps/server/app/v1/nodes/trunk-status/route.ts`), `NODE_SECRET`-
    authenticated exactly like `/v1/nodes/config`. A report failure is
    logged, never thrown — it must not block the trunk-config sync it's
    piggybacked on.
  - `backend/packages/api/src/node-service.ts#reportTrunkStatus` stores it on the
    existing `nodes` collection document (matched by `ip`, the same
    identity `authenticate` already uses), extending `NodeDocument`
    (`backend/packages/api/src/persistence.ts`) with optional `trunkStatus`/
    `trunkStatusReportedAt`. `NodeSchema`/`TrunkStatusSchema`/
    `TrunkStatusReportSchema` are new contracts
    (`backend/packages/contracts/src/nodes.ts`).
  - Registration state and `TrunkPool` health are two genuinely independent
    signals surfaced side by side, not merged into one status — a trunk can
    be `Registered` but recently provider-rejected on calls (`healthy:
    false`), or vice versa (registration briefly dropped, no recent call
    attempts to prove call-level health either way).
  - Rendered in `/admin`'s existing "Telephony nodes" panel as a per-node
    sub-table (registration badge + failover health), reusing the already-
    fetched `nodes` list — no separate fetch.
  - **Requires the droplet's agent to be redeployed to actually start
    reporting** — happens automatically on the next push to `main` per the
    existing `deploy-droplet` CI job (see "Droplet auto-deploy" above), no
    manual step. Until then, `/admin` simply shows no trunk-status
    sub-table for that node (treated as "not yet reported", not an error).
- **Queue depth**: `backend/packages/api/src/verification-queue.ts#getQueueCounts` adds
  a thin wrapper over BullMQ's own `Queue#getJobCounts()` for all three
  queues this app runs (`verification-jobs`, `verification-callbacks`,
  `verification-provider-reconcile`), exposed via a new admin-session-gated
  route, `GET /v1/admin/queues`
  (`backend/apps/server/app/v1/admin/queues/route.ts`) — `queues` is now retained on
  `ServerContext` (`backend/apps/server/lib/server-context.ts`) rather than only used
  locally inside `buildServerContext`. Rendered as a manual-refresh table in
  the new `frontend/app/admin/ops-panel.tsx`. Not unit-tested directly (it's
  a thin passthrough to BullMQ's own well-tested method, same as this
  project's existing `enqueueDispatch`/`enqueueCallback` helpers, which
  aren't unit-tested against a real Redis either) — verify live via
  `/admin` once deployed.

## Phase 7: usage counters, callback diagnostics, alerting, retention (implemented)

The remaining Phase 7 items chosen for this session — usage counters/
dashboards (admin-wide and per-project), callback delivery diagnostics
(visibility only), alerting, and a retention policy — deliberately reused
existing data/patterns everywhere possible rather than adding new
infrastructure:

- **Per-project usage counters already existed** (`Project#stats` —
  `total`/`succeeded`/`failed`/`byType`, computed by
  `backend/packages/api/src/verification-reporting.ts#computeProjectStats` and already
  rendered on the customer dashboard's `project-card.tsx`) — nothing new
  was needed here, just confirmed as already covering the customer-facing
  half of this session's usage-counters scope.
- **Admin-wide usage counters** (the new half): same shape, aggregated
  across every project — `computePlatformStats` (a small refactor of
  `computeProjectStats` to share one `aggregateStats` helper with an
  optional filter), `VerificationService#platformStats`, and a new
  admin-session-gated route, `GET /v1/admin/usage`
  (`backend/apps/server/app/v1/admin/usage/route.ts`). Rendered as a new manual-
  refresh panel, `frontend/app/admin/usage-panel.tsx`, reusing the exact
  `statsGrid`/`opsTable` CSS classes already used elsewhere on `/admin`.
- **Callback delivery diagnostics (visibility only, no manual retry)**: the
  data already existed — `backend/packages/api/src/callback-worker.ts` has recorded
  every delivery attempt (`delivered`/`failed`, status code, error, attempt
  number) to the `callbackDeliveries` collection since Phase 3. This session
  only added visibility: `verification-reporting.ts#listRecentCallbackDeliveries`
  (most recent 50, newest first), `VerificationService#recentCallbackDeliveries`,
  a new admin route `GET /v1/admin/callback-deliveries`
  (`backend/apps/server/app/v1/admin/callback-deliveries/route.ts`), and a new panel
  `frontend/app/admin/callback-deliveries-panel.tsx`. New contract:
  `CallbackDeliverySummarySchema`/`CallbackDeliveriesResponseSchema`
  (`backend/packages/contracts/src/verification.ts`).
- **Alerting**: emails `ADMIN_EMAIL` (the existing Brevo integration already
  used for customer email verification — `backend/packages/api/src/email.ts` gained
  `EmailService#sendAdminAlert`, no new credential) when any of three
  conditions trip, checked every 5 minutes by a new BullMQ repeatable job
  (`platform-alerts` queue, `backend/packages/api/src/alert-worker.ts`, scheduled via
  `scheduleAlertChecks` — idempotent stable `jobId`, safe to call on every
  server boot, wired into `backend/apps/server/lib/server-context.ts`):
  - A queue's `waiting + delayed` job count exceeds `QUEUE_BACKLOG_THRESHOLD`
    (50), or its `failed` count exceeds `QUEUE_FAILED_THRESHOLD` (20) —
    checked for every queue this app runs.
  - The failure/expiry rate among interactions created in the last hour
    exceeds `FAILURE_RATE_THRESHOLD` (50%), but only once at least
    `FAILURE_RATE_MIN_SAMPLES` (5) interactions exist in that window, so a
    single failed call on a quiet day never triggers a false alarm.
  - A telephony node has gone quiet past the same `NODE_STALE_THRESHOLD_MS`
    (3x the agent's 60s poll interval) the `/admin` staleness badge already
    uses — this constant moved to `backend/packages/contracts/src/nodes.ts` so
    both sides share one definition of "stale" instead of two independent
    hardcoded values.
  - All three condition checks (`backend/packages/api/src/alerting-service.ts`) are pure
    functions taking already-fetched data (queue counts, a total/failed
    count pair, a node list) — no Mongo/BullMQ/Node handle passed in — so
    they're unit-tested (`alerting-service.test.ts`) without any live
    connection; only `alert-worker.ts` does the actual fetching.
  - A new `alertState` collection (`AlertStateDocument`, one row per
    triggered condition key, e.g. `queue_backlog:verification-jobs`,
    `node_stale:<nodeId>`) backs a one-hour cooldown
    (`backend/packages/api/src/alert-dispatcher.ts#dispatchAlerts`) so an ongoing
    problem re-emails at most once per hour, not every 5-minute check.
    Silently a no-op (not an error) whenever `ADMIN_EMAIL` is unset, the
    same deferred-configuration convention as every other optional feature.
  - Thresholds are plain hardcoded constants (not new env vars) —
    deliberately kept simple; revisit only if real alert noise/silence in
    production shows they need tuning.
- **Retention (18 months, no deletion before then, no archival built yet)**:
  the user was explicit `verificationRequests`/its events/its callback
  deliveries — the platform's one durable transaction/report/billing
  source — must never be manually or eagerly deleted, but 18 months after
  creation they should stop being kept in the hot Mongo collection. Fixed
  with three new single-field TTL indexes (`{ createdAt: 1 }` /
  `{ occurredAt: 1 }`, `expireAfterSeconds: RETENTION_PERIOD_SECONDS`
  where `RETENTION_PERIOD_SECONDS` = 548 days ~= 18 months, rounded up so
  nothing expires a day early) on `verificationRequests`,
  `verificationEvents`, and `callbackDeliveries`
  (`backend/packages/api/src/verification-persistence.ts`) — the exact same mechanism
  this project already uses for `sessions`/`emailVerifications`/
  `idempotencyRecords`, just with a much longer horizon. **Deliberately not
  built yet, per the user's own explicit framing this session**: exporting
  data to cold storage (the user mentioned Wasabi, explicitly not
  DigitalOcean Spaces, with a plain file download, not a specific format
  yet) before the 18-month TTL deletes it — the user's framing was "we're
  not at 180 days yet to be worried about this... we'll deal with 6-month
  archiving at 6 months time." Nothing is close to the 18-month mark today,
  so there is no urgency; a future session should raise this again once
  real data approaches that age, not before. Do not provision Wasabi
  credentials or build an export job speculatively.

## Hosted verification modal (Phase 8, implemented)

The remaining Phase 8 scope was clarified through direct Q&A with the user
before any code was written (per the standing "ask before building" rule)
into something more specific than `docs/PLAN.md`'s original wording: not a
generic embeddable widget-loader script or a separate docs site, but a
**POWEROTP-hosted, POWEROTP-branded verification modal** for customers who
only need the plain OTP function (not the future bot-blocker middleware) —
the end user types their own phone number directly into a page POWEROTP
hosts and controls, so the customer's frontend never has to build call/SMS/
code/challenge UI or handle a phone number at all. "API documentation" and
"copy this to your AI" were confirmed to already be covered by the existing
MCP server (deepened this session, see below) rather than needing a new
artifact — the user's own words: "all the instructions are on the mcp and
clients read api.powerotp.com/mcp ... the actual account connection is done
when the user enters the API creds in their site."

- **Why a new "session" concept was needed**: today's
  `POST /v1/projects/{slug}/verifications` requires the caller to already
  know `targetNumber` — it's designed for a customer's backend that already
  has the number (e.g. from its own signup form). The hosted modal flips
  that: the end user types the number *into the modal itself*, so a new,
  more limited credential has to exist *before* any interaction does. A
  "modal session" (`backend/packages/contracts/src/modal-sessions.ts`,
  `backend/packages/api/src/modal-session-persistence.ts`,
  `backend/packages/api/src/modal-session-service.ts#ModalSessionService`) is created
  by a customer's own backend with its project API key
  (`POST /v1/projects/{slug}/modal-sessions`, optionally narrowing
  `allowedTypes` to a subset of the project's own `enabledMethods` — always
  re-validated server-side, never trusted at face value) and is the *sole*
  credential every subsequent public route accepts. It never carries a
  project's API key, callback URL, or any other project secret — just
  `allowedTypes`, an attempt counter (capped at
  `MODAL_SESSION_MAX_ATTEMPTS = 3`, generous enough to retry a busy/
  no-answer call, tight enough that one session can't become a call-spam
  vector), and a 24-hour TTL (`modalSessions` collection, same
  `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` pattern as `sessions`/
  `emailVerifications`). `ModalSessionService#requireActive` also checks
  `expiresAt` manually on every read, since Mongo's TTL sweep only runs
  periodically, not the instant a document expires.
- **The hosted page**: `frontend/app/widget/[sessionId]/page.tsx` +
  `widget-client.tsx` — a customer embeds
  `modalUrl` (returned alongside `sessionId`/`expiresAt` from session
  creation) directly, typically in an iframe. On load it fetches
  `GET /v1/modal-sessions/{sessionId}` (public — the session id itself is
  the credential) for `allowedTypes`/`attemptsRemaining`/the project's
  display name, renders a phone-number field (plus a method choice if more
  than one type is allowed), and on submit calls
  `POST /v1/modal-sessions/{sessionId}/verifications`, which internally
  calls the same, unchanged `VerificationService.create()` every other path
  already uses (`browserResponse` forced `true` server-side) — no
  duplicated verification-creation logic.
- **Status polling needed a real (small) change to the existing status
  route, not zero changes as first assumed while planning this**: the
  modal has no project API key, so it cannot poll
  `GET /v1/verifications/{interactionId}` the way it worked before this
  session (API-key-only). Fixed by adding a second, `view_status`-scoped
  interaction-token action (`backend/packages/contracts/src/verification.ts`'s
  `InteractionTokenClaimsSchema.action` enum gained `"view_status"`
  alongside the existing `submit_code`/`submit_challenge`) that the status
  route now also accepts via the same `x-interaction-token` header the
  response route already used — but, unlike those two, **never single-use
  consumed**, since polling the same interaction repeatedly is expected,
  not a replay. This token's `audience` is a fixed constant
  (`backend/packages/api/src/interaction-tokens.ts#WIDGET_STATUS_TOKEN_AUDIENCE`, not
  the request's `Origin` header) — deliberately different from the
  existing submit-action tokens, which must match a customer's own
  allowlisted origin: a same-origin `GET` fetch isn't guaranteed to always
  carry an `Origin` header across browsers, and the modal is always served
  from this one control-plane origin regardless, so there's nothing extra
  an origin check would defend against here beyond what the token's own
  signature/expiry/project/interaction-id scoping already covers. The
  session-scoped verification-creation route always issues this
  `view_status` token (even for `call_reachability`, which has no response
  step at all) alongside the normal submit-action token when one applies,
  returned together as `ModalSessionVerificationAcceptedSchema`'s
  `statusToken`/`interactionToken` — a new response shape distinct from the
  plain `VerificationAcceptedSchema`, since the customer-facing create route
  never needs a status token (its caller already has an API key).
- **The customer's backend still gets the authoritative result the exact
  same way it always has**: the existing signed HMAC callback
  (unchanged — see "Signed callbacks" throughout this document). The
  modal's own `window.parent.postMessage({ source: "powerotp-widget",
  state, reasonCode, ... })` on a terminal state is a same-page UX
  convenience only (so an embedding page can e.g. close the modal
  immediately) — **explicitly documented, in the MCP content and here, as
  never authoritative**: it's plain `postMessage` from a page whose script
  a customer doesn't control, trivially spoofable by anything else running
  in that browser tab, and must never be the basis for a security-sensitive
  decision.
- **`@powerotp/widget-loader`** (`libraries/widget-loader/src/index.ts`,
  repurposed this session): `mountPowerOtpWidget({ container, modalUrl,
  onEvent })` mounts the iframe and relays `message` events to a
  caller-supplied callback — previously took a raw `interactionToken`
  before this session's design, which didn't fit the "end user hasn't
  entered a number yet" flow at all.
- **`@powerotp/server-sdk`** (`libraries/sdk-js/src/index.ts`, completed
  this session): `PowerOtpClient` gained `createModalSession(allowedTypes?)`
  (posts to the sibling `.../modal-sessions` path of the configured project
  URL), `getVerificationStatus(interactionId)`, and
  `submitResponse(interactionId, body)` (both against the top-level
  `/v1/verifications/...` paths on the project URL's origin) — previously
  create-only. Also exports a standalone `verifyCallbackSignature` function
  mirroring `backend/packages/api/src/callback-signing.ts`'s algorithm exactly (a
  deliberate, documented duplication rather than an `@powerotp/api`
  dependency — that package is server-internal, pulling in BullMQ/MongoDB/
  the AWS SDK, nothing a customer's own backend should ever need to
  install). **Both packages remain `private: true`, unpublished** — the
  user's own framing was to complete them now and defer publishing to a
  public registry as a separate decision (needs an npm org/token that
  doesn't exist yet); revisit only if asked.
- **MCP deepened** (`backend/packages/mcp/src/content.ts`/`mcp-app.ts`): fixed a
  real, previously-shipped bug (`integration-overview.creation` was missing
  the `/v1` prefix on the creation path — never actually reachable if a
  reader tried to use it literally), added `status`/`callbacks`/
  `hostedModal` fields to `integrationOverview` (previously silent on the
  status endpoint, callback signature format, and this whole hosted-modal
  option), and a new `generate_modal_session_example` tool/
  `buildModalSessionExample` function alongside the existing
  `generate_example`. Still fully read-only/public — no new tool touches
  live project data.
- **Power Passport (placeholder UI only, no backend this session)**: a
  separate section on the same `/widget` page, aimed at AI agents/bots
  rather than the human OTP flow — conceptually the seed of a future
  bot-blocker middleware phase, added at the user's specific request this
  session but deliberately not built out: a "Power Passport key" text
  field, explanatory copy about sites letting compliant AI agents pay to
  access protected data instead of completing human verification, and a
  link to purchase one at `powerotp.com` (mentioning example agent names
  like ClaudeBot/Hermes Agent). Submitting the field does nothing real yet
  (a "coming soon" notice) — no key format, no server-side validation, no
  purchase/billing flow. Same treatment as the deferred customer-balance
  billing and Wasabi archival elsewhere in this document: placeholder now,
  real logic only once fully specified by the user. **Documented eventual
  intent, not built**: a valid passport key would let the requester skip
  human phone verification entirely and access the protected content
  directly.
- **Bot-signal honeypot (built for real, since it's simple and
  self-contained)**: a "Website AI index summary" link on the same page,
  visually hidden from real visitors (off-screen CSS positioning, not
  `display: none` — some scrapers skip elements hidden that way — plus
  `aria-hidden`/`tabIndex={-1}` so it's also invisible to assistive tech, not
  just sighted users) but present in the raw DOM, so only something parsing
  markup directly (not a rendered page) would ever find and follow it.
  Hitting it (`GET /v1/modal-sessions/{sessionId}/ai-index-summary`) logs a
  raw `"possible bot"` signal (timestamp, best-effort project/session
  context, IP, user agent) to a new `botSignals` collection
  (`backend/packages/api/src/bot-signal-service.ts`,
  `backend/packages/api/src/modal-session-persistence.ts#BotSignalDocument`, 90-day TTL
  — a detection primitive's data doesn't need the 18-month billing-record
  retention the verification collections have) and returns a harmless
  `{ summary: "coming_soon" }` body. Deliberately minimal: no scoring, no
  blocking, no relationship yet to the Power Passport concept above — a
  future bot-blocker phase is what would actually consume this signal.
  Never rate-limited and never fails the request on a logging error, on
  purpose: throttling a honeypot would just teach a scraper to slow down,
  and a broken signal pipeline must never become a visible bug for whatever
  triggered it.

## Shared verification UI: the "verified" celebration and the public demo response route

Added right after the hosted modal above, in the same session, at the
user's request that the "try it now" marketing demo actually show the same
branded modal experience a real end user gets, and that a successful
verification play a polished animated moment ("spin the modal ... pop
sound ... sparkles ... a big green human face silhouette and verified
text") **on both surfaces** — the demo and every real customer's hosted
modal.

- **`frontend/app/verification-modal/verification-modal-view.tsx`**
  (`VerificationModalView`, new, shared): the "a verification is running"
  view — live progress text, code/challenge entry once
  `awaiting_response`, and the terminal result. Deliberately agnostic of
  *how* status is fetched or a response is submitted (passed in as
  `fetchStatus`/`submitResponse` callbacks) since the two callers need
  different auth: the hosted modal's `widget-client.tsx` uses interaction
  tokens, the public demo (`try-it-now.tsx`) uses nothing at all. Extracted
  from `widget-client.tsx`, which now renders it instead of duplicating
  that logic once a session's phone number step is done.
- **`frontend/app/verification-modal/verified-celebration.tsx`**
  (`VerifiedCelebration`, new): the actual animated success moment,
  three phases — (1) a green checkmark draws in (SVG stroke animation) while
  a short synthesized "pop" plays (`pop-sound.ts`, a Web Audio API
  oscillator + gain envelope, not an embedded audio file — nothing to host
  or ship as a binary asset); (2) the checkmark card spins, shrinks, and
  fades while ~16 small sparkles burst outward (each a `<span>` with a
  precomputed `--tx`/`--ty` CSS custom property, randomized angle/distance/
  delay in JS, animated via one shared keyframe); (3) a large green human
  silhouette (inline SVG, not a photo) fades/scales in with "Verified"
  text. A failed verification renders the existing plain "Not verified"
  panel instead — no celebration. Runs identically wherever
  `VerificationModalView` renders a terminal `succeeded` state, so this is
  automatically consistent between the demo and every real hosted modal by
  construction, not by copying the animation twice.
- **New public route,
  `POST /v1/demo/verifications/{interactionId}/response`**
  (`backend/apps/server/app/v1/demo/verifications/[interactionId]/response/route.ts`):
  the demo previously only ever watched status, never let a visitor
  actually submit the code/challenge answer they received — this was a
  real functional gap the new "show the actual modal in the demo" request
  exposed, not just a UI change. Scoped exactly like the existing demo
  create/status routes (anonymous, but only for the one
  operator-configured demo project —
  `backend/apps/server/lib/demo-project.ts#requireDemoProject`,
  extracted this session so a third demo route didn't triplicate that
  same project-lookup logic). Reuses `VerificationService#submitCode`/
  `#submitChallenge` unchanged — same grading logic as the real,
  API-key/interaction-token-gated response route.
- **`frontend/app/try-it-now.tsx`**: once a demo verification is created,
  renders a second card next to the existing request/response JSON panel
  (`.tryItNowRow`, flex-wrap so it stacks on narrow screens) — the exact
  same `VerificationModalView` a real customer's end user sees, prefilled
  with the phone number the visitor already typed (no separate number entry
  in this preview; it's driven by the same interaction the main form
  already created, not a second one).

## Widget interaction visibility: end-user IP/User-Agent (visibility only)

Added right after the hosted modal above, at the user's explicit request,
scoped to exactly what was asked: capture, not act on. The end user's own
IP and User-Agent are now captured directly from their browser's request to
`POST /v1/modal-sessions/{sessionId}/verifications` (the actual "widget
interaction" — the only point where the *end user's* own browser talks to
POWEROTP, as opposed to a customer's backend) and stored as new optional
`endUserIp`/`endUserUserAgent` fields on `VerificationRequestDocument`
(`backend/packages/api/src/verification-persistence.ts`), written via a new
`VerificationService#recordEndUserMeta` (a plain metadata write, mirroring
`recordProviderAttemptMeta`, never a state-machine transition). Deliberately
**never** captured on the customer-backend-created path
(`POST /v1/projects/{slug}/verifications`) — the caller there is a
customer's own server, not the end user, so an "IP" captured there would
just be that server's IP, not a meaningful signal, and never trusted from a
header a caller could set itself (only ever read via
`backend/apps/server/lib/api-route.ts#clientIp`, the same Cloudflare-aware helper used
everywhere else).

Surfaced read-only on `/admin` via a new "Widget interactions" panel
(`frontend/app/admin/widget-interactions-panel.tsx`, `GET
/v1/admin/widget-interactions`, `VerificationService#recentWidgetInteractions`,
`backend/packages/api/src/verification-reporting.ts#listRecentWidgetInteractions`) —
manual-refresh, most recent 50, same convention as every other admin panel
this project has. **Explicitly visibility/audit only**: no fraud/risk
scoring, rate limiting by IP, or any other logic is attached to this data
yet — if a concrete use for it comes up, that's a future, separately-scoped
addition, not something to build speculatively now.

## SMS fallback hint, retry-as-call, and card close buttons

`VerificationModalView` (`frontend/app/verification-modal/verification-modal-view.tsx`)
shows "Didn't get a text? Try a phone call instead. Some carriers block
international SMS." under the code-entry field whenever an `sms_code`
interaction reaches `awaiting_response` — added after live-testing an SMS
to a Thailand number that was accepted by VoIP.ms (`code_sent`) but likely
never actually delivered by the carrier (no delivery-receipt integration
exists yet to confirm either way; see the git history around this commit
for the live investigation). **This exact hint text is shown identically
on both the real hosted modal and the marketing-site demo, and never
mentions bots or anything forward-looking** — the user was explicit that
the actual UI copy end users see must not reference future plans.

- **"Try a phone call instead" is a real action**, via a new optional
  `onRetryAsVoiceCall` prop: the caller (either `widget-client.tsx` or
  `try-it-now.tsx`) starts a brand-new `voice_code` attempt for the same
  phone number, then re-renders `VerificationModalView` with a changed
  `key={interactionId}` — React fully remounts it, so the new attempt is
  its own clean "operation" (fresh progress states, its own eventual
  celebration) rather than continuing the old one's state. `widget-client.tsx`
  only offers this when the session's `allowedTypes` actually includes
  `voice_code`.
- **Every widget card gained a close (`×`) button**
  (`.widgetCardClose`, top-right of `.widgetCard`) — on the real hosted
  modal this both hides the card locally and `postMessage`s
  `{ source: "powerotp-widget", type: "closed" }` to the parent window (a
  UX signal only, same non-authoritative caveat as the terminal-state
  message); on the demo preview it just removes the floating card from the
  page.
- **A separate, demo-only explanatory note — the one place "bot" language
  appears in any UI at all**: "For Bot Blocker, this OTP challenge will
  only be shown to suspected bots." rendered above (not inside) the
  demo's floating
  modal-preview card (`.tryItNowBotNote`, `frontend/app/try-it-now.tsx`)
  — explicitly per the user's instruction that this framing belongs on the
  marketing demo for evaluators, never inside the real widget a real end
  user sees. No bot detection exists to gate this on; it's a static
  explanatory caption on the demo page only.

## Known gaps / next steps

**This section is the project's to-do list.** Nothing here is an accepted
permanent limitation — every item is work still owed, and an item is meant to be
deleted (not softened) once it genuinely works end-to-end. Where an item is
blocked, the blocker is named explicitly so a future session can see immediately
whether it can act or needs something from the user first. The three current
hard blockers are: **DigitalOcean account access** (no API token here and
`doctl` isn't installed — blocks the Reserved IP, Spaces provisioning, and
testing the node rebuild script), **VoIP.ms support** (the `trunk-2`/`trunk-3`
403s; local debugging is exhausted), and **real business numbers from the user**
(the per-country rate charts, which are all still $0).

1. `call_reachability` and `voice_code` are both **confirmed working end-to-end live**,
   including the trunk pool's rotation and mid-attempt failover against two real broken
   VoIP.ms subaccounts (see "Outbound trunk pool" above's "Live confirmation"
   subsection). Not yet observed live: a busy/no-answer/rejected/invalid outcome (the
   Q.850 cause-code mapping is only unit-tested so far), and there is no automated
   canary/synthetic-check running this periodically — a regression would currently only
   be caught manually or by real customer traffic.
2. `TRUNK2`/`TRUNK3` (`334140_power2/power3`) still register but get `403 Forbidden` on
   every call — a VoIP.ms account-side issue pending their support (unchanged finding
   from the prior session, still true as of this session's live retest), see the
   "Outbound trunk pool" section's incident note above; not blocking, since the pool
   rotates onto `TRUNK1`/`TRUNK4` while waiting.
3. `sms_code` (Type 4) is **confirmed working end-to-end live** as of this session, after
   fixing a real `multipart/form-data` POST-encoding bug (see "Phase 6 SMS provider
   adapter" above's incident note) — do not assume that bug is still present if
   `sms_code` fails again; check the new diagnostic log line first. Country/prefix
   limits, opt-out suppression, and provider delivery callbacks remain pre-public-launch
   policy/hardening work; the current adapter normalizes synchronous `sendSMS`
   acceptance or rejection only.
4. `voice_challenge` (Type 3) is code-complete and unit-tested (see "Phase 5
   recording/challenge pipeline" above) but still not validated against a real droplet:
   DigitalOcean Spaces is still not provisioned, so there is no published recording/
   challenge to select — it still fails closed correctly with `no_published_challenges`.
   The droplet *has* been redeployed with the media-sync/challenge-call code this
   session (same redeploy that shipped the trunk pool), so once Spaces is provisioned
   and a challenge is published, no further droplet redeploy should be needed just for
   this.
5. The agent currently places one call at a time, serially (across every type it
   handles), whichever type it tries first each poll cycle — there is no concurrency
   limit to configure yet because there is no concurrency. Revisit once real traffic
   needs more than one simultaneous call per node.
6. The trunk pool (`TrunkPool`) currently lives entirely in one agent process's memory —
   health/rotation state is not shared across nodes and resets on an agent restart. Not
   a problem yet (one droplet, `powerotpvoip1`); would need externalizing (e.g. into
   Valkey) if multi-node routing (Phase 9) is ever built.
7. Provider cost/duration reconciliation (see "Provider cost reconciliation" above) is
   **confirmed working end-to-end live** — a `call_reachability`, `voice_code`, and
   `sms_code` demo verification all correctly matched a real VoIP.ms `getCDR`/`getSMS`
   row with correct duration/cost extraction on the first attempt (see that section's
   "Confirmed live" subsection for the exact figures). **Customer balance billing is now
   implemented** (see "Customer balance billing" above) — tiers, per-country call/SMS
   rate charts, the monthly/daily plan charge, the transactional ledger, insufficient-
   balance enforcement, and Stripe fixed-amount top-ups. Not yet done: no rate has
   actually been entered into the admin rate charts yet (every country bills $0 until an
   admin does), no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set yet (top-ups fail
   closed with `billing_not_configured`), and this has not been live-tested end-to-end
   against a real Stripe test-mode payment or a real customer balance actually reaching
   $0 and blocking a request. The future BotBlocker "visit" per-visitor charge (100k/month
   allowance then billed in 100k blocks) is explicitly deferred — see that section's last
   bullet for the user's exact described rule, recorded so it isn't lost.
   **The real-customer-blocking gap itself is now addressed**: a full "Customer signup
   flow" (see that section above) lets a real customer actually reach a nonzero balance —
   a per-type free monthly usage quota for their first 180 days, plus an admin manual
   balance credit/debit action (`POST /v1/admin/billing/credit`) for support cases. Still
   not done: no rate has actually been entered into the admin rate charts yet (every
   country still bills $0), and a real Stripe test-mode top-up has still never been
   performed end-to-end even though the user reported `STRIPE_SECRET_KEY`/
   `STRIPE_WEBHOOK_SECRET` as now configured in App Platform this session (not
   independently re-verified live).
8. **Phase 7 is now mostly done** (see the new "Phase 7: usage counters,
   callback diagnostics, alerting, retention" section above): usage
   counters (admin-wide and per-project), callback delivery diagnostics
   (visibility only), alerting (queue backlog / high failure rate / stale
   node, emailed to `ADMIN_EMAIL`), and an 18-month Mongo TTL retention
   policy are all implemented. Deliberately not built yet, per the user's
   own explicit framing: archiving to cold storage (Wasabi, not
   DigitalOcean Spaces) before the 18-month TTL deletes anything — revisit
   once real data actually approaches that age (the user's own words:
   "we'll deal with 6-month archiving at 6 months time"), not
   speculatively. Also not built: a manual "retry this callback" admin
   action (visibility only was the explicit scope this session).
9. **Phase 8 is now substantially implemented** (see "Hosted verification
   modal" above): a POWEROTP-hosted verification modal (session creation,
   the hosted `/widget` page, a new read-only `view_status` interaction-
   token action for browser polling), a completed (private, unpublished)
   server SDK and widget-loader, and a deepened MCP server. Not done:
   publishing either package to a public registry (deferred, needs an npm
   org/token that doesn't exist yet — revisit only if asked), and the
   Power Passport concept is UI-placeholder only (no key validation,
   purchase flow, or billing — see that section for the documented, not-yet-
   built, eventual intent). This session's new routes/page have not been
   live-tested against a real embedded iframe on a third-party site yet —
   code-complete and unit-tested, same caveat as most new surfaces on first
   landing. Phase 9 (production hardening) has still not been started at
   all.
10. **Customer signup flow is now implemented** (see that section above):
    password pepper, the rapid signup modal (account + first project/API key
    together), an email-verification gate before any real usage, a per-type
    free monthly usage quota for an account's first 180 days (no per-type
    minimum balance floor — tried and removed, see that section), Brevo
    template support, an admin manual balance credit/debit action, and a
    data-minimization design where most services only ever pass around an
    opaque `userId`, never touching the PII-bearing `users` document
    directly. The 5th verification type raised and scoped out in this
    session's Q&A (email-based OTP) was picked up and fully built in a
    later session — see "Email verification type, customer branding, and
    dashboard redesign" above; it is no longer deferred. Also not yet done
    from this session: `POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID` is documented but
    no Brevo template
    has actually been created from the
    HTML in that section yet, and the free-quota/email-gate/pepper logic has
    not been live-tested end-to-end against real production Mongo (unit-tested
    only, same caveat as most new surfaces on first landing).
11. **`email_code`, customer-branded delivery templates, and the dashboard
    tabs redesign are now implemented** (see "Email verification type,
    customer branding, and dashboard redesign" above). Not yet done: no
    `email_code` rate has actually been entered into the new admin email-rate
    card yet (defaults to $0, same "gathered by an admin" convention as
    every other rate chart); `email_code` is not reachable through the
    hosted widget yet (direct API integration only — see that section for
    why); `brandLogoUrl` is a pasted link only, not a real file upload
    (blocked on DigitalOcean Spaces provisioning for customer assets, which
    still doesn't exist); the new "Visitors" tab's "Threat score" column is
    UI framing only, with no scoring model behind it; and none of this
    session's new surfaces (an actual `email_code` send, the branded
    template rendering, the dashboard tabs, or the Visitors tab) have been
    live-tested against real production Mongo/Brevo yet — unit-tested and
    `npm run verify`-clean only, same caveat as most new surfaces on first
    landing.
12. **The droplet deploy path is hardened and the node is now rebuildable from
    the repo** (see "Droplet deploy hardening" and "Node rebuild / disaster
    recovery" above). Still open from that work: **no DigitalOcean Reserved IP is
    attached**, so a rebuild changes the IP and drags a six-step checklist with
    it. **Blocked on DigitalOcean account access** — attaching a Reserved IP is
    an API/control-panel action, and this environment has no DO API token and no
    `doctl`. To unblock: a read/write DO API token (ideally exported as
    `DIGITALOCEAN_TOKEN` on the operator's machine rather than pasted into chat),
    after which the Reserved IP, the Spaces provisioning in item 13, and the
    rebuild-script test below can all be done without further input.
    Also still open: `bootstrap-node.sh` has been syntax-checked and is
    derived from the live box's actual inspected state, but has **never been run
    end-to-end against a genuinely fresh droplet** — the first real DR event will
    be its first full execution, so budget time for it to be slightly wrong. The
    test is cheap (create a throwaway droplet, run it, destroy the droplet) and is
    blocked on the same token. (`MEDIA_MANIFEST_SECRET`/`MEDIA_ROOT` being absent
    from the live droplet's `agent.env` is *not* a gap — that is correct until
    Spaces is provisioned; see "Node rebuild / disaster recovery".)
13. **`voice_challenge` cannot work end-to-end until DigitalOcean Spaces is
    provisioned.** The code is complete and unit-tested and fails closed
    (`media_storage_not_configured` / `no_published_challenges`), but
    `SPACES_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` and the independent
    `MEDIA_MANIFEST_SECRET` are unset in App Platform, so there is no manifest for
    the agent's `media-sync.ts` loop to fetch. Finishing it means: create the
    Spaces bucket, generate its keys, set those five values in App Platform, then
    add `MEDIA_MANIFEST_SECRET` + `MEDIA_ROOT=/var/lib/asterisk/sounds/custom` to
    the droplet's `/etc/powerotp/agent.env` and restart the agent
    (`bootstrap-node.sh` does the droplet half automatically when the secret is
    supplied). **Blocked on the same DigitalOcean access as item 12.** This is
    also what blocks `brandLogoUrl` becoming a real file upload instead of a
    pasted link (item 11).

### Incident: `npm ci` OOM-killed on the droplet during the Phase 5 redeploy (fixed with a permanent swap file)

Redeploying `apps/telephony-agent` after Phase 5 landed (`npm ci` at the monorepo root,
per `infrastructure/asterisk/README.md`'s deploy steps) got the kernel OOM-killer to kill
the `npm ci` process outright (`dmesg`: `Out of memory: Killed process ... (npm ci)
total-vm:1868604kB, anon-rss:636624kB`), leaving a half-installed `node_modules` and
making `sshd` itself briefly unresponsive (TCP connected but the SSH banner exchange
never completed) while the box was thrashing. Root cause: `powerotpvoip1` has only
961Mi of RAM and **had zero swap configured**, and installing the full monorepo's
dependency tree (Next.js 16, the AWS SDK, `@ffmpeg-installer/ffmpeg`, etc. — all needed
to build `@powerotp/contracts`/`@powerotp/telephony-agent` even though the agent itself
only runs a small fraction of that dependency tree at runtime) exceeded available
memory. **Fixed permanently, not with a one-off retry**: added a 2GB swap file
(`/swapfile`, `fallocate` + `mkswap` + `swapon`, persisted in `/etc/fstab` so it survives
a reboot) — a standard, safe mitigation for small-RAM droplets doing occasional
memory-heavy work like a monorepo install. After adding swap, `rm -rf node_modules` and
re-running `npm ci` completed cleanly (used ~146Mi of swap, never came close to OOM
again). If a future session redeploys and sees `sshd` become unresponsive or `npm ci`/
`npm run build` silently disappear, check `dmesg -T | grep -i oom` and `free -h` first,
and confirm `swapon --show` reports the 2GB file before assuming anything else is wrong.

### Incident: a fast-answered call could get stuck at `ringing` forever (job-poller report race)

Live-tested against a real answered call: a `call_reachability` demo verification
answered almost instantly, and `apps/telephony-agent` logged the job as `succeeded`
(`{"msg":"call job finished","state":"succeeded","reasonCode":"answered"}`) — but the
verification's actual state in the API stayed at `ringing` forever, never advancing.
Root cause: `job-poller.ts` calls `report("ringing")` and `report("answered")` from
call-control code (`reachability-call.ts`, etc.) **without awaiting** each one's HTTP
round-trip (it must stay responsive to ARI events, not block on a network call), then
separately awaits one final result report. `VerificationService#transition` is
optimistic-concurrency (read current `state`+`sequence`, then a conditional
`findOneAndUpdate` matching both) — if two of these unawaited reports for the same
interaction are ever in flight at once and arrive at the server out of order, whichever
one's conditional write loses the race is **silently rejected** (the route returns a
`409`, which `reportJobEvent` turns into `{ applied: false }` without throwing, so
neither the fire-and-forget `.catch()` nor the final `await` — which never checked
`.applied` — ever surfaced it). A call answered quickly enough for `ringing` and
`answered` to race each other over the network could permanently strand the
interaction at whichever state happened to land last. **Fixed** in `job-poller.ts`: every
report for one job (progress and the final result) is now chained through a single
promise so each is fully applied at the server before the next is even sent, making the
race structurally impossible — plus the final report's `.applied` result is now logged
if ever rejected, so a regression here wouldn't be silent again. Covered by
`apps/telephony-agent/src/job-poller.test.ts` (asserts the agent never has two `/events`
requests for the same job in flight at once, regardless of individual request latency).

### Incident: a local ARI password was accidentally echoed to chat

While inspecting `/etc/asterisk/ari.conf` on `powerotpvoip1` to confirm the agent's ARI
env var names, a `cat` command without redaction leaked the real local ARI password
(the `powerotp-agent` ARI user's password) into chat output. Severity is low — this
credential only authenticates to ARI bound to `127.0.0.1` on the droplet itself, never
reachable from the internet or from App Platform — but per the user's standing
instruction to never echo raw credentials pulled from live systems, it should be treated
as compromised. **Action for a future session: regenerate the `powerotp-agent` ARI
password** (a new random value in `/etc/asterisk/ari.conf`'s `[powerotp-agent]` stanza
and the matching `ARI_PASS` in `/etc/powerotp/ari.env`, then `asterisk -rx "core reload"`
and restart `powerotp-agent`) next time this droplet is touched. This does not affect
`NODE_SECRET` or any VoIP.ms credential — only this one local-only value.

## Pre-Phase-18 accounting foundation (implemented 2026-08-19)

This roadmap prerequisite extends the existing customer balance system; it does not create a
second wallet or project ledger. `financialTransactions` remains append-only and
`customerBalances` remains its transactionally updated current-balance projection.

- New ledger writes use `paymentProcessor` plus `paymentProcessorTransactionId`, allowing
  independently namespaced IDs from Stripe and future processors. Historical `stripePaymentId`
  rows remain readable as Stripe history. OTP ledger types now expose the exact verification
  method (`call_reachability`, `voice_code`, `voice_challenge`, `sms_code`, or `email_code`)
  instead of opaque `otp1`–`otp5` labels.
- `BalanceService#applyLedgerEntries` writes ordered multi-account batches in one MongoDB
  transaction. Source and referral rows, balance projections, durable idempotency claims, and
  settlement/cooldown state commit or roll back together. Every commission row links to and
  snapshots the amount/percentage of its immutable source row.
- `projectAuthSessions` stores closed, immutable customer-site signup/signin reports with project,
  session, timestamp, ad system, allotted slots, filled slots, and idempotency key. Reports require
  the project API credential, rate limit, bounded timestamp, and `filled <= allotted`; browser code
  cannot author financial values.
- Admin-created `billingThresholdRules` carry an event type, positive threshold, three
  balance-tier charge amounts, and active state. The daily worker counts the true preceding 30
  days and uses `projectThresholdChargeStates.lastChargedAt` to prevent the same project/rule from
  charging again until a full 31 days has elapsed.
- Admin-created `adSystems` identify ad sources. The latest-ten-days UTC calendar accepts one
  operator-entered gross payout pool per ad system and complete day. The daily worker can settle a
  late entry for any day still in that window, aggregates immutable filled slots, allocates the
  pool proportionally in integer micro-USD using deterministic largest remainder, and guarantees
  all project credits sum exactly to the entered pool. `adDailyPayouts` and
  `adDailySettlements` make every system/day/project settlement immutable and retry-safe.
- Customer-created referral codes support `powerotp.com/{code}` first-touch attribution through a
  30-day SameSite cookie consumed by the next successful signup. Account attribution is immutable.
  Each project may independently select a non-self referral code; replacements close historical
  attribution and affect only future rows. Admin commission percentages independently cover
  signup charges, signin charges, ad deposits, and actual daily recurring charges.
- Customer project cards show trailing-30-day signup/signin counts, project referral assignment,
  and project-filtered ledger rows. The admin accounting panel manages ad systems, the ten-day
  payout calendar, threshold rows, and referral commission percentages. No rates, thresholds,
  payout amounts, ad systems, referral codes, or commissions are seeded.

Security and audit boundaries are documented in `THREAT_MODEL.md`; every new backend route is
listed in `API_ROUTE_INVENTORY.md`. Focused contracts, API, backend, and frontend checks passed,
followed by a clean final root `npm run verify`.
