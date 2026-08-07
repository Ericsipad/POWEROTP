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
  outbound trunk config, and the `call_reachability` trunk is `Registered` against
  VoIP.ms.
- **VoIP.ms**: account exists; `OUTBOUND1_URL/USER/PASS` (call_reachability) has real
  credentials set in App Platform and is confirmed registering successfully.
  `OUTBOUND2..3_*` (voice_code and voice_challenge) are still unset SIP placeholders —
  see `apps/api/src/outbound-trunks.ts`. SMS does not use a trunk: its dedicated
  `VOIPMS_SMS_API_USERNAME/PASSWORD/DID` variables are currently unset pending the
  planned combined live-credential validation pass.
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
  real production Mongo/Valkey. Since no real telephony/SMS transport exists yet, every
  verification currently resolves `queued → dispatching → failed` with reason
  `method_not_available` — this is expected, not a bug, until Phase 4 lands.
- **Public demo widget**: added ahead of Phase 4 (not in the original phase list) — a
  "try it now" widget on the marketing homepage hero, backed by the anonymous, tightly
  scoped `/v1/demo/verifications` endpoints and the `prj_demo` project above.
- **Phase 4 (voice types 1 and 2 / telephony)**: **in progress, both types now have
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
  machinery. Not yet done: live credentials for the other methods and
  `voice_challenge`'s media/call-control; a busy/no-answer/rejected outcome hasn't been observed
  live yet (only the cause-code mapping is unit-tested), and there is no automated
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
  below. Live Spaces/OUTBOUND3 credentials are deliberately deferred, same as Phase 4/6.
- **Phase 6 (SMS)**: provider adapter implemented and unit-tested; live VoIP.ms SMS API
  credentials are deliberately deferred until the combined validation pass.
- **Phases 7–9**: not started.

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
  liveness heartbeat), `configFor` (returns whichever `OUTBOUND1..3_*` voice trunks are
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

## Phase 4 ARI call-control (`call_reachability` and `voice_code`, implemented)

The control plane never talks to Asterisk/ARI directly — only a droplet's
`apps/telephony-agent` does, over ARI bound to `127.0.0.1`. Since a node only ever
*polls* the control plane (never the reverse), a second, much faster poll loop was
added alongside the existing 60-second trunk-config sync so call dispatch doesn't wait
a full minute:

- `apps/api/src/transport.ts#createNodeDispatchTransport` replaces the voice methods'
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
  - Originates `PJSIP/{targetNumber}@trunk-call-reachability` directly into a Stasis app
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
  ARI digit playback (`media=digits:12345,digits:12345`, repeated per
  `CODE_REPEAT_COUNT`, currently 2) and hangs up once `PlaybackFinished` fires,
  resolving at `awaiting_response` (not a terminal state — the code is graded later by
  the existing, unchanged `submitCode` flow from Phase 3, not by anything the node
  does). `apps/telephony-agent/src/job-poller.ts` now tries each type this node has a
  trunk for in turn (currently `call_reachability` then `voice_code`) each poll cycle.
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
  (`apps/api/src/security.ts#createFiveDigitCode`) when one isn't supplied.

## Phase 5 recording/challenge pipeline (`voice_challenge`, implemented)

`voice_challenge` (Type 3) is code-complete and unit-tested end to end: admin-authored
recordings and challenges, private Spaces storage, a signed media manifest, node media
sync, and ARI recording playback — reusing the same encrypted-secret and node-dispatch
machinery already proven for `voice_code` rather than introducing anything new.

- **Contracts**: `libraries/contracts/src/challenges.ts` (`ChallengeSchema`,
  `ChallengeSubmissionSchema`, `CreateChallengeSchema`, `RecordingAsset`) already existed
  before this phase and needed no changes; `NodeJobSchema` in
  `libraries/contracts/src/nodes.ts` gained an optional `soundBasename` for claimed
  `voice_challenge` jobs.
- **Storage**: two new Mongo collections, `recordingAssets` and `challengeDefinitions`
  (`apps/api/src/challenge-persistence.ts`), plus a `{ type, state, createdAt }` index on
  the verification collection to support `claimNextForNode` filtering by type at scale
  (`apps/api/src/persistence.ts`). The verification document's previously-unused
  singular `answerOptionId` field was replaced with an embedded, per-interaction
  `challenge` snapshot (`challengeDefinitionId`, freshly shuffled `challengeOptions`,
  `expectedAnswerOptionIdsEncrypted`) — see `apps/api/src/verification-persistence.ts`.
- **`apps/api/src/media-service.ts`**: validates an admin upload (magic-byte sniffing for
  WAV/MP3/M4A, a hard size cap rejected before even inspecting contents) and normalizes
  it with `@ffmpeg-installer/ffmpeg` (an npm static binary, not a DigitalOcean Aptfile —
  App Platform's Aptfile buildpack doesn't reliably expose system FFmpeg at runtime) to
  8kHz mono, matching the existing PJSIP `allow=ulaw,alaw` codec config so the output is
  directly playable via ARI's `sound:` media type with no dialplan change. Also computes
  the SHA-256 checksum a node later verifies before trusting a download.
- **`apps/api/src/spaces-client.ts`**: a thin S3-compatible wrapper (`@aws-sdk/client-s3`
  + `@aws-sdk/s3-request-presigner`) over the private Spaces bucket — `putObject` for
  admin publish, `presignedGetUrl` (short-lived) for node download. Telephony droplets
  never hold Spaces credentials at all, matching the "no per-node secrets" node-identity
  model; a node instead receives one presigned URL per recording from the manifest
  route below.
- **`apps/api/src/challenge-service.ts`** (`ChallengeService`): admin `publishRecording`/
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
- **`VerificationService`** (`apps/api/src/verification-service.ts`): `create()` binds a
  challenge synchronously via `selectAndMaterialize()` for `voice_challenge` — a missing
  published challenge is a content-catalog precondition, so it fails the request
  immediately with `no_published_challenges` (409), the same way a bad E.164 number or
  unsupported method already does, rather than waiting until dispatch like an
  unconfigured trunk. `toStatus()` only includes `challenge` (question/options, never
  correctness information) once the verification has reached `awaiting_response` or a
  later terminal state (`hasReachedAwaitingResponse()` in
  `apps/api/src/verification-state-machine.ts`) — never at `queued`/`dispatching`/
  `calling`/etc., so a status poll can't see the challenge before the recording has
  actually been dispatched for playback. `submitChallenge()` grades a submission the
  same way `submitCode()` grades a voice/SMS code, and `soundBasenameForDelivery()`
  mirrors `codeForDelivery()` for the claiming node.
- **`apps/api/src/transport.ts`**: `voice_challenge` now uses
  `createNodeDispatchTransport`, identical in shape to `call_reachability`/`voice_code` —
  it still fails immediately with `method_not_available` if `OUTBOUND3` isn't
  configured; the challenge-content precondition above is checked earlier, at creation,
  not here.
- **Admin routes** (`apps/web/app/v1/admin/recordings/route.ts` + `[id]/route.ts`,
  `apps/web/app/v1/admin/challenges/route.ts` + `[id]/route.ts`): session + CSRF gated
  exactly like `/v1/admin/demo-project` (`requireAdminSession` + `verifyCsrfHeader`; IP
  allowlisting is enforced once at admin login, not re-checked per request, consistent
  with every other admin route). `/admin`'s new `challenges-panel.tsx` wires recording
  upload and challenge authoring into the existing admin page.
- **`GET /v1/nodes/media-manifest`** (`apps/web/app/v1/nodes/media-manifest/route.ts`):
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
  same per-poll-cycle loop as the other two voice types, only when this node has an
  `OUTBOUND3` trunk and its media-sync loop is enabled.
- **Response route**: `POST /v1/verifications/{interactionId}/response` now branches on
  verification type to accept `ChallengeSubmissionSchema` (opaque option IDs) alongside
  the existing code path; the browser-response interaction token reuses the existing
  `submit_challenge` action that already existed in the contracts.
- **New optional config**: `SPACES_ENDPOINT`/`SPACES_BUCKET`/`SPACES_ACCESS_KEY`/
  `SPACES_SECRET_KEY` and an independent `MEDIA_MANIFEST_SECRET` (never reused for
  `NODE_SECRET`) in `apps/api/src/config.ts` — all optional, all covered by the same
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
"@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]` to `apps/web/next.config.ts` —
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
- `apps/api/src/sms.ts#createVoipMsSmsService` calls VoIP.ms's `sendSMS` REST method
  over HTTPS. Credentials use dedicated `VOIPMS_SMS_API_USERNAME`,
  `VOIPMS_SMS_API_PASSWORD`, and `VOIPMS_SMS_DID` App Platform variables rather than
  the SIP-shaped `OUTBOUND4_*` variables. Parameters are sent as POST form data so the
  API password never appears in a request URL.
- `apps/api/src/transport.ts#createSmsCodeTransport` drives
  `queued -> dispatching -> awaiting_response` after provider acceptance and normalizes
  provider/API failures to stable `provider_rejected` or `provider_unavailable` reason
  codes. The atomic `queued -> dispatching` transition is also the send claim, so a
  BullMQ retry cannot submit the same SMS twice. Missing or partial credentials retain
  the production-safe `method_not_available` behavior.
- The existing `POST /v1/verifications/{interactionId}/response` endpoint now grades
  both `voice_code` and `sms_code`; browser-response interaction tokens use the same
  existing `submit_code` action.
- Adapter and lifecycle behavior are unit-tested without live credentials. Live
  provider validation remains deliberately deferred until all planned methods are
  code-complete, when credentials will be supplied once for the combined end-to-end
  validation pass.

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
  trunk. **Also added a `[transport-udp]` PJSIP transport directly to `pjsip.conf`** —
  every transport in the packaged sample config ships commented out, and with zero active
  transports `res_pjsip_outbound_registration` silently fails to create any registration
  object at all (`res_sorcery_config.c: Could not create an object of type 'registration'
  with id '...'` in `/var/log/asterisk/messages.log`, with no other symptom — the
  endpoint/aor/auth/identify objects from the same file load fine, which is what made this
  confusing). This is droplet-level infrastructure, not something the agent renders,
  because it doesn't vary per trunk.
- **Confirmed live**: with real `OUTBOUND1_URL/USER/PASS` (San Jose VoIP.ms server) set in
  App Platform, the agent rendered the trunk and `pjsip show registrations` shows
  `trunk-call-reachability` as `Registered` against VoIP.ms — outbound SIP registration
  works end-to-end. Actual call dialplan/ARI logic is still not built (next step).
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
`OUTBOUND1..3_*` voice-trunk placeholders are set in App Platform and deployed; `powerotp-agent` on
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

1. `OUTBOUND1` (call_reachability) has real VoIP.ms credentials, is confirmed
   `Registered`, and its ARI call-control logic is **confirmed working end-to-end**
   against one real live answered call (see "Phase 4 (voice types 1 and 2 /
   telephony)" above). Not yet observed live: a busy/no-answer/rejected/invalid
   outcome (the Q.850 cause-code mapping is only unit-tested so far), and there is no
   automated canary/synthetic-check running this periodically — a regression would
   currently only be caught manually or by real customer traffic.
2. `voice_code`'s call-control logic (speak the code, then defer to the existing
   `submitCode` flow) is **built and unit-tested but not yet exercised against a real
   live call** — `OUTBOUND2` has no real VoIP.ms credentials yet, so its transport
   still fails immediately with `method_not_available` in production today, same as
   before this session. **Deliberately deferred, per explicit instruction**: get
   `OUTBOUND2`'s real VoIP.ms credentials from the user only once the rest of the
   planned work is code-complete, then do one full pass validating every wired-up
   method end-to-end together, rather than one live-credential round-trip per method.
3. `sms_code` (Type 4) is built and unit-tested but its dedicated
   `VOIPMS_SMS_API_USERNAME/PASSWORD/DID` variables are still unset, so production
   correctly returns `method_not_available` today. Live sending and response grading
   remain part of the deliberately deferred combined end-to-end validation pass.
   Country/prefix limits, opt-out suppression, and provider delivery callbacks remain
   pre-public-launch policy/hardening work; the current adapter normalizes synchronous
   `sendSMS` acceptance or rejection only.
4. `voice_challenge` (Type 3) is code-complete and unit-tested (see "Phase 5
   recording/challenge pipeline" above) but not yet validated against a real droplet:
   DigitalOcean Spaces is not provisioned, `OUTBOUND3` has no real VoIP.ms credentials,
   and `powerotpvoip1` has not yet been redeployed with the media-sync/challenge-call
   code. Same deliberately-deferred pattern as `voice_code`/`sms_code` above.
5. The agent currently places one call at a time, serially (across every type it
   handles), whichever type it tries first each poll cycle — there is no concurrency
   limit to configure yet because there is no concurrency. Revisit once real traffic
   needs more than one simultaneous call per node.
6. Everything else in Phases 4–9 per `docs/PLAN.md`.

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
