# POWEROTP BotBlocker progressive development phases

This is the execution order for the architecture defined in
[`POWEROTP_BOTBLOCKER_PLAN.md`](POWEROTP_BOTBLOCKER_PLAN.md). Ground truth for completed
work belongs in `POWEROTP_BOTBLOCKER_AS_BUILT.md` once Phase 0 creates it, with only
high-level architecture/deployment changes repeated in [`AS_BUILT.md`](AS_BUILT.md).

## End goal

BotBlocker is a customer-installed browser/request integration for React, Node,
TypeScript, and later other platforms. It is an additive, state-publishing integration:
middleware gathers trusted request data, communicates with
POWEROTP using the customer's server-only site credential for initial session creation and
narrow server-held visitor tokens thereafter, and attaches recommended state; the browser SDK
publishes updates and never acts on customer content. Customer code alone decides whether and
how to use that state; supported integrations do not enforce it. POWEROTP checks first-party
clearance and Passport proofs (human challenge-installed or purchased
agent/PaidTokenPass-backed), gathers
approved initial browser evidence, combines it with trusted server IP/context, and asks POWEROTP
for one of exactly two decisions:

- `allow`: recommend normal access and continuously observe.
- `otp`: publish an OTP recommendation and expose the single argument-free `gate.openOtp()` API
  for explicit customer use.

The complete initial middleware request is saved immediately as the session snapshot and first
risk event. The first follow-up behavior report is sent after five seconds. Further reports are
sent every 30 seconds and when a partial interval ends because of navigation, page hide, or exit.
Reports contain sanitized route paths (no query or fragment), element categories and
explicit `data-powerotp-id` values, document-normalized click points, bounded 32×32 pointer
heatmap bins, explicit page ID/name, page active/total time, and navigation targets (never
clicked text, form values, query strings, or chronological pointer trails), plus
mouse-directness, scroll smoothness/speed aggregates, and honeypot activations. Every report is
saved to the visitor session and may revise a
previous `allow` or valid clearance to `otp`.

Behavior reports are separate from the broad browser/device fingerprint vector. Phase 17 corrects
the incomplete Phase 10/15 implementation by collecting bounded browser, hardware, rendering,
font, audio, and capability components through a pinned industry-standard collector. Raw
fingerprint components are retained on the Mongo master without inbound hashing. Only after the
raw profile write does the server derive the one versioned verify lookup HMAC from the approved
stable subset and store it on `userIntelligence` for edge publication. Page content, form values,
passwords, raw keystrokes, clicked text, and chronological pointer trails remain prohibited.

The customer chooses a decision timeout from 50 through 2,000 ms; 200 ms is the
recommended default. Timeout/network failure publishes fail-open access state but does not
cancel the pending decision. A late `otp` updates the recommendation. POWEROTP never alters
customer DOM or routes automatically; customers decide whether to follow every state.

`gate.openOtp()` accepts no OTP type, method, policy, or content arguments. POWEROTP resolves
the authenticated site/session decision server-side and returns only short-lived metadata for
the server-selected hosted iframe. The empty same-origin opener request uses the HttpOnly
visitor gate-session cookie; the customer server resolves trusted site/session state and
forwards the narrow server-held token minted during the site-credential-authenticated first
contact. Session/site IDs identify records but authorize nothing by themselves.
This BotBlocker opener is separate from ordinary signup, password-recovery, and other
customer-initiated OTP API flows, whose customer request/configuration determines their own
verification content.

Website-facing recommendations are derived lifecycle state: `checking` means
the `restricted` label; verified `allow`, timeout fail-open, or unavailable fail-open means
`full_access`; verified `otp` means `otp_required`; authoritative OTP success means
`full_access`. These are advisory labels, not extra backend decisions or rendering/access
effects.

POWEROTP internally correlates pseudonymous fraud/security evidence across protected
sites, while each customer can see only visitors and observations from its own projects.
Each `userIntelligence` profile is the continuing behavior/risk record and may remain anonymous
or later become associated through an authoritative `identityBindings` record. Supabase
Enterprise holds user identity/account PII; MongoDB intelligence holds only an opaque/keyed
internal reference. Every accepted report updates the session/profile, later scoring
recalculates on that update, and an authoritative risk change may revise the recommendation to
`otp` and suspend identity-bound Passport/paid-access fast paths until recovery.
The customer's API key remains server-only. POWEROTP never receives customer page
content, raw keystrokes, form values, raw pointer trails, or URL query strings.

## Why the integration boundary is built before proprietary backends

The public contract, endpoint names, browser state machine, framework wrappers, and MCP
installation format are the compatibility boundary every customer will install. They
must be designed first so the later blacklist, user-intelligence, scoring, OTP-policy,
Passport, payment, billing, and Cloudflare implementations plug into one stable,
auditable protocol instead of forcing every customer to rewrite their integration.

This order does **not** permit fake production behavior. Unfinished services return
typed unavailable responses, and wrappers use the real fail-open rule. No placeholder
score, blacklist match, Passport approval, paid entitlement, or OTP success may be
fabricated. The system is not activated for customers until the real backing phases and
end-to-end acceptance tests are complete.

## Session-size and handoff rule

Each numbered phase is one fresh Cursor session and one independently verifiable unit.
Normally touch no more than 3–8 closely related production modules plus tests/docs.
If a phase would consume 20% or more of a fresh AI context, split it into lettered
subphases before editing. Never start the next numbered phase in the same session.

At every phase end:

1. Run focused tests and proportionate workspace verification.
2. Update `POWEROTP_BOTBLOCKER_AS_BUILT.md` with outcome, files, contracts,
   configuration names, tests, deployment/manual steps, findings, and risks.
3. Update `AS_BUILT.md` only for architecture, infrastructure, or deployment changes.
4. Update the plans when evidence invalidates an assumption.
5. Show git status and state commit/push/deploy status. Never commit or push without
   explicit instruction.
6. Print a complete, copyable fresh-session prompt for the next phase and stop.

Every generated handoff prompt must include repository/path/branch/HEAD/status, first
git checks, required docs and files, completed work, tests, deployment/manual actions,
next scope and exclusions, unresolved user decisions, environment caveats, and no raw
secrets or PII. End it with:

> Do not start later phases in this session; finish this phase, update the as-built
> record, and print the next fresh-session prompt.

## Progressive phases

### Phase 0 — Reconcile specification and threat model

Update the BotBlocker plan, threat model, and Passport/legal plan for additive advisory state,
50–2,000 ms fail-open timeout, continuously revisable `allow | otp`, sanitized
five-second/30-second telemetry, internal cross-site fraud intelligence, and
DigitalOcean-first/Cloudflare-later deployment. Create `POWEROTP_BOTBLOCKER_AS_BUILT.md` and a
SOC 2/ISO 27001 control-status matrix. The historical Phase 0 implementation instead encoded
automatic optimistic/page-lock semantics; Phase 13A records and supersedes that mistake.

**Exit:** no contradiction remains between product, threat, privacy, Passport, and
execution documents.

### Phase 1 — Base protocol contracts

Add versioned identifiers, adapter/request context, browser evidence, first/recurring/
partial behavior reports, report sequence, decision revision, timeout, and stable error
contracts in `backend/packages/contracts/src/botblocker.ts`, with boundary/prohibited-field
tests.

### Phase 2 — Decision, challenge, and proof contracts

Add the only-two-outcome `allow | otp` union, challenge lifecycle, policy, clearance,
Passport assertion, PaidTokenPass assertion, risk-event batch, and explicit unavailable
responses. Reject unsigned clearance, browser-supplied scores, and fake valid proofs.

### Phase 3 — Ed25519 signed-artifact primitive

Implement canonical Ed25519 sign/verify helpers with key ID, audience, site/session,
issued/expiry times, and nonce. Test forgery, audience, expiry, future issuance,
canonicalization, and key mismatch. Do not reuse OTP HMAC secrets.

### Phase 4 — Key rotation and replay controls

Add active/previous key overlap, retirement/revocation, clock-skew bounds, and Valkey
one-time nonce consumption. Document environment names without creating real values.

### Phase 5 — Project configuration and timeout UI

Add `botblockerSites`, `GET/PATCH /v1/projects/{projectId}/botblocker`, and a disabled-
by-default dashboard panel with a numeric 50–2,000 ms timeout field and 200 ms
recommendation. Use customer session + CSRF; activation waits for real readiness.

### Phase 6 — Gate-session and intelligence persistence

Define/index `gateSessions`, `userIntelligence`, `riskEvents`, and
`botblockerChallenges`. Repeated IPs are observations, not unique identities. Encode
approved variable TTL retention before real collection; never seed fake data.

### Phase 7 — Signed policy service

Add immutable `policyReleases` and `GET /v1/botblocker/policy/{siteId}` with signatures,
ETag, compatibility, key set, timeout, sensor version, activation/expiry, last-known-
good handling, and rollback protection. No active release means `policy_unavailable`. The
key set here is a key-*ID* reference only; Phase 14A adds the actual key material and the
adapter-side client that consumes it.

### Phase 8 — Complete central API surface

The planned primary authenticated rapid-check origin is
`https://verify.powerotp.com/v1/botblocker/*`. It is not deployed yet. Phase 27 deploys
it on Cloudflare Workers with at least 30 days of current user-intelligence,
denylisted-IP, and user-row-derived verify lookup data. `https://api.powerotp.com` remains the
authoritative full-history master-data service and required fallback rapid-check origin when the
edge is unavailable or cannot resolve a lookup.
Operator routes are separately authenticated under `/v1/control/botblocker/*`.

Create permanent authenticated/rate-limited route handlers for:

- `POST /v1/botblocker/rapid-auth`
- `POST /v1/botblocker/visitor-token-refresh`
- `POST /v1/botblocker/browser-assessment`
- `POST /v1/botblocker/risk-events`
- `POST /v1/botblocker/challenges`
- `GET /v1/botblocker/challenges/{challengeId}`
- `POST /v1/botblocker/challenges/{challengeId}/complete`
- `POST /v1/botblocker/passports/register`
- `POST /v1/botblocker/passports/assert`
- `POST /v1/botblocker/paid-passes/assert`
- `POST /v1/botblocker/agent/entitlements`
- `GET /v1/projects/{projectId}/botblocker/visitors`
- operator `/v1/control/botblocker/rapid-list`,
  `/v1/control/botblocker/decision-traces/{gateSessionId}`,
  `/v1/control/botblocker/health`, and `/v1/control/botblocker/policy-releases` routes

Unimplemented services return typed unavailable responses, never synthetic outcomes. The
historical Phase 8 implementation left every route above at one fixed, unscoped global URL per
operation; Phase 8A must correct that boundary.

### Phase 8A — Site-scoped webhook endpoint routing

**Status: complete (2026-08-16).** The as-built entry records the focused corrections and the
exact verification sequence, including the initial full-command failure and successful
workspace-level corrections; it does not claim that failed command exited successfully.

Replace the fixed runtime URLs with an immutable, cryptographically self-validating
project/site-scoped endpoint token. Its HMAC binds format version, random endpoint ID, project
ID, and site ID under a dedicated server secret. Reject malformed or forged tokens with a bare
404 before Valkey, MongoDB, request-body parsing, credential authentication, nonce/idempotency,
or business logic. Only a locally valid token may resolve its exact project/site record.

Project creation must generate the project ID, project API key, BotBlocker site ID, endpoint
token, independent webhook signing secret, encrypted signing-secret record, and required audit
records in one MongoDB transaction. Any failure aborts the whole transaction; there is no
cleanup-hook substitute and no migration/backfill because there are no production BotBlocker
records.

Initial runtime contact uses the site credential, creates the visitor session, and returns a
30-minute token bound to project/site/session/audience. Every subsequent visitor report,
challenge, Passport, paid-pass, or entitlement call uses that visitor token instead of the site
credential. Inactive project/site readiness returns typed `offline`; adapters fail open, stop
ordinary runtime calls while offline, and use bounded readiness polling. `offline` and
`fail_open` remain lifecycle states, never decisions. `GET /v1/botblocker/policy/{siteId}` and
dashboard/customer APIs retain their existing boundaries.

The complete first request is saved as the session snapshot and initial immutable risk event,
including available trusted IP, browser/fingerprint, request, proof, and risk data. Create the
session row before returning, persist only token ID/expiry/one-way digest metadata there, and
never persist the reusable bearer. The middleware writes the bearer to its server-side gate
session. At minute 29 the middleware sends the refresh request and replaces its stored bearer
without changing the session ID or linked `userIntelligence` row.

### Phase 9 — Framework-neutral browser gate

Implement lifecycle state around exactly `allow | otp`. The timeout publishes fail-open state
without aborting a pending request, and any newer signed report decision may revise access to
OTP. Expose recommendation subscriptions and an explicit argument-free OTP opener; do not
alter customer DOM or rendering automatically. Implement safe returns and authoritative
polling triggers with no API key in browser code. The historical Phase 9 implementation used
an automatic page lock; Phase 13B corrects that boundary.

### Phase 10 — Continuous browser sensor

Implement versioned environment evidence, first report at five seconds, recurring
30-second reports, partial navigation/hide/exit reports, sanitized routes/clicks,
mouse-directness and scroll-smoothness metrics, automation indicators, report ordering,
and stale-decision handling. Prove prohibited raw data cannot be emitted.

### Phase 11 — Raw Node HTTP wrapper

Build the dependency-free Node 22 wrapper with local clearance verification,
`/_powerotp/*` handlers, trusted proxy configuration, exclusions, limits, timeout,
events, challenge polling, cookies, and the `/.well-known/powerotp-agent` discovery
contract. Verify with a minimal Node fixture. CleanDataPage itself is PowerOTP-hosted and
must not be scaffolded into customer applications.

### Phase 12 — Express wrapper

Wrap the shared protocol in dedicated Express middleware/router and a React fixture.
Document ordering before static/SSR/API routes and test proxy modes, streaming, uploads,
errors-after-headers, exclusions, and WebSocket non-interference.

### Phase 13 — Next.js wrapper

Generate native `proxy.ts`, `app/_powerotp/*` handlers, root gate component, and the
`/.well-known/powerotp-agent` discovery contract. Test App Router navigation,
server/client boundaries, assets, CSP, iframe behavior, runtime constraints, and absence
of secrets in bundles. Do not create a customer-hosted CleanDataPage route.

### Phase 13A — Advisory-boundary specification recovery

Correct the Phase 0–13 product specification before generating public integrations. POWEROTP
middleware/SDK gathers evidence and controls recommended state through the plugin protocol;
installed customer code alone decides whether and how to act, and supported integration code
must never enforce, suppress, or branch customer content. Define timeout as fail-open lifecycle
state rather than a fabricated `allow`, define the
single argument-free OTP opener with server-selected iframe content, preserve historical
as-built entries, and schedule 13B–13D without changing runtime behavior or contracts.

### Phase 13B — Advisory browser contracts and state API

Add strict initial proof/evidence and public recommendation snapshots. Expose
subscribe/getSnapshot plus one argument-free `openOtp()` method. Remove automatic customer-DOM
freeze/iframe effects; opening OTP must require an explicit customer call and server-validated
site/session decision. The browser call has an empty body and relies on the HttpOnly same-origin
gate session; it never accepts an API key or caller-supplied ID. Snapshots map
lifecycle/decisions to restricted, full-access, or OTP-required recommendations for customer
consumption without customer-content effects. Preserve pending timeout work, 5-second/30-second sensing, revisions, polling,
acknowledgement, and typed unavailable defaults.

### Phase 13C — Shared Node and Express advisory adapters

Make gate-node the single authority for local proof verification, trusted request/IP context,
server-to-server credential use, visitor sessions, pending decisions, and verified
recommendation state while leaving the customer handler/response in control. Add bounded
initial-evidence bridging, store the opaque scoped token returned by first contact only on the
server, and expose framework-native state for customer-owned use. State is attached to every
customer application request except fixed technical exclusions; no selective-route callback or
enforcement is part of the wrapper. Later per-visitor calls
forward that token without resending the site credential. Keep Express thin and prove no
route/body/stream/DOM interference.

### Phase 13D — Next.js advisory adapter and cross-wrapper conformance

Expose trusted recommendation/session state through native Node-runtime Proxy and an additive
App Router provider/hook without rewrites or rendering control. The fixture must leave customer
content untouched and prove that state publication causes no rendering branch or automatic
`openOtp()` call; explicit argument-free `openOtp()` remains separately tested. Verify
cross-wrapper non-interference, client-bundle credential absence, and all inherited security
boundaries. Phase 14 is blocked until 13D passes.

### Phase 14 — Public MCP generator

Add BotBlocker architecture/data resources and integration/config/troubleshooting tools.
Generate separate versioned/checksummed `node-http`, `express`, and `nextjs` source
manifests with exact placement, env names, dashboard steps, tests, exclusions, readiness,
and upgrades. MCP remains public, anonymous, read-only, and credential-free.

### Phase 14A — Automatic verification-key delivery

The already-shipped raw Node/Express/Next wrappers require a constructor-supplied Ed25519
`verificationKeys` value. The target returning-visitor credential is the signed, persistent,
site-scoped `powerotp_site_return` cookie bound to the exact `userIntelligence` row. Its presence
publishes immediate local access while the adapter starts the active visitor session and awaits
updates that may revoke access or require OTP. It is distinct from the active-session
`powerotp_gate` cookie and short-lived `powerotp_access` clearance (see
[`libraries/gate-node/src/cookies.ts`](../libraries/gate-node/src/cookies.ts)). This is the same
"Signed Policy Client" the plan already describes — Phase 7 built the signed policy release and
its `GET /v1/botblocker/policy/{siteId}` endpoint, but that endpoint's key set today is a key-*ID*
reference only (`PolicyKeyReferenceSchema`), and no wrapper fetches it. Phase 14A closes that gap:

- Extend the Phase 7 policy release contract and stored release to carry the active/previous
  Ed25519 public key material itself (SPKI DER, base64), not only a key ID, reusing the existing
  active/previous overlap and revocation shape from `@powerotp/botblocker-signing`.
- Add a policy-fetch client to the shared `@powerotp/gate-node` authority that resolves
  `verificationKeys` from `GET /v1/botblocker/policy/{siteId}` using only the public `siteId`,
  with the existing last-known-good caching and signed-rollback-rejection rules from the
  "Signed Policy Client" section of `POWEROTP_BOTBLOCKER_PLAN.md`.
- Once this ships, `siteId`/`siteCredential` become the only two values a customer configures;
  `verificationKeys` stops being a constructor argument the customer supplies directly. Update
  Phase 14's MCP templates and environment-variable catalog in the same phase that this ships.
- No change to the `allow | otp` decision boundary, the site-credential/scoped-visitor-token
  separation, or any other Phase 13B–13D behavior.

### Phase 15 — Real intelligence/event ingestion

Implement browser assessment and risk-event ingestion with idempotency, ordering,
server-derived fingerprints, project scoping, retention, visitor-session reports, and
project-only querying. Store sanitized route/click evidence, normalized click points,
client-aggregated pointer heatmap bins, explicit page metadata, page active/total time,
navigation transitions, and aggregate behavior evidence; do not score yet.

### Phase 16 — Rapid allowlist/blacklist

Implement real versioned allow/blacklist entries with provenance, expiry, revocation,
admin audit, lookup, and signed snapshots. Allowlist maps to `allow`; blacklist maps to
`otp`; conflicts/staleness fail safely. Unknown visitors still require the next phase.

### Phase 17 — Proprietary scoring

**Implementation status: complete (2026-08-19).** Phase 17 execution steps 1–7 are complete.
External IP-reputation vendor integration is not a Phase 17 step and does not block Phase 18; it
is deferred to the final optional development add-on in Phase 32.
The approved design is saved in
[`POWEROTP_BOTBLOCKER_PHASE17_PROPRIETARY_SCORING_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17_PROPRIETARY_SCORING_PLAN.md);
the approved gate-session synchronization subplan is saved in
[`POWEROTP_BOTBLOCKER_PHASE17A_SESSION_INPUT_REDUCER_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17A_SESSION_INPUT_REDUCER_PLAN.md).
Despite its historical filename, that subplan does not design the separate `riskEvents` reducer.

Correct the incomplete fingerprint boundary first: collect and retain a broad, bounded,
versioned browser/device vector using exactly pinned `@fingerprintjs/fingerprintjs` v5.2.0 with
monitoring disabled and expensive probes run once per new gate session. FingerprintJS is only a
component collector: discard its visitor ID and confidence result, map failures to bounded typed
availability, and persist its raw vector without inbound hashing. Profile matching uses the
signed user-intelligence-bound site-return cookie or Passport first, otherwise exact raw
fingerprint comparison on the home API; IP alone never merges profiles. Only after raw
fingerprint collection, write the approved stable-source fields during `userIntelligence`
creation/update and derive the one versioned verify lookup HMAC from those row values; replace
that current field without retaining aliases.

Store one current complete bounded component vector per profile in the shared `fingerprintData`
collection, retained for 548 days. Do not place the full vector on the hot `userIntelligence` row
or create fingerprint rows at five-/30-second behavior-report cadence. The fixed gate-session
synchronizer copies the approved latest-successful scoring fields plus the bounded internal
stable-source fields needed for same-row verify derivation, maintains current IP and at most 20
unique prior IP entries with observation-time ASN/blacklist values, and refreshes separate global
and same-site exact-IP distinct-profile counts for 1, 7, and 30 days. Apply it at most once per
accepted gate session in one transaction before scoring/callback use. Keep `gateSessions` and
linked `riskEvents` as one logical 90-day session dataset.

The approved step-7 design is
[`POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md).
Replace the separate initial, behavior, and risk-signal report inputs with one canonical report
used at session start and for every update. One immutable `riskEvents` row is scored at insert
time by a separate unseeded operator field registry. Available row scores atomically update
`userIntelligence.risk_events_sum`, the arithmetic average exposed as one configurable numeric
input to the existing overall profile scorer. Raw report detail stays on the event row. Missing
inputs are excluded; configuration changes do not backfill prior row scores or reset the average.
External vendor profile/scoring fields are outside Phase 17 and remain deferred to Phase 32,
after a real vendor and bounded fields are approved.

The first canonical report preserves blacklist-first precedence, then awaits the current profile
score within the existing 50–2,000 ms timeout. Later accepted reports enqueue a signed
project-specific data-ready callback only after committed profile scoring; middleware verifies it
and pulls authoritative session data with the scoped visitor token. Local headless detection
remains advisory only. CGNAT is not a direct observable signal, and IPv4/IPv6 remain lookup/storage
families rather than score inputs. Step 7 was completed in fresh sessions for canonical
contract/transport, event-row configuration/scoring, and `risk_events_sum` profile integration.
Phase 17 is complete; Phase 18 follows next.

### Phase 18 — Customer risk/OTP policy

Add the 0–100 dashboard policy and score-band-to-enabled-OTP mapping, signed policy
release, readiness/balance validation, fallback behavior, and immutable audit events.

### Phase 19 — OTP orchestration

Wire real OTP decisions to existing modal sessions, verification state machine, billing,
transports, and authoritative status. Bind decision/challenge/interaction/project/
fingerprint/expiry. Only authoritative success issues clearance; cover replay/retry/
timeout/failure/cancel. Expose one argument-free `openOtp()` launch: the customer cannot choose
method/content at call time. Initial RapidAuth uses the site credential to mint a short-lived,
revocable, audience/site/session-bound token stored by the adapter; `openOtp()` forwards only
that token. POWEROTP resolves the HttpOnly-bound visitor gate session to user intelligence and
selects both from authoritative site/session policy. The token remains absent from browser
JavaScript.

### Phase 20 — Continuous reassessment and lockout

Persist every complete/partial report, rerun scoring, return monotonic signed decision
revisions, and reject stale responses. Any score reaching the customer's OTP threshold
publishes an `otp` recommendation at any point in the session. For identity-bound intelligence,
the same authoritative update may suspend Passport/PaidTokenPass fast access pending the
server-defined OTP/recovery flow. Customer code may then call `openOtp()`; POWEROTP never
changes customer UI automatically. Pause page sensing only after the customer explicitly opens
OTP and resume a fresh interval after authoritative success. Clearance and Passport state never
disable reassessment.

### Phase 21 — Passport cryptographic/storage foundation

Finalize the shared install-once Passport envelope with explicit `human | agent` credential
class, consent/audit, device or proof-of-possession public keys, top-level assertion flow, and
pairwise site assertions. Make Supabase Enterprise the authoritative ISO 27001-scoped account/
identity store for email, password/authentication hashes, verified attributes, and other PII.
Add MongoDB `identityBindings` that associate project-scoped `userIntelligence` profiles with
only an opaque/keyed internal user reference after authoritative account/Passport/entitlement
verification; never copy PII or expose a network-global user ID to customers. Test store
separation, class separation, unlinkability, binding authorization, revocation, expiry, device
loss, and replay.

### Phase 22 — Human Passport lifecycle

After a person completes a challenge, offer explicit installation of a persistent Human
Passport. Implement registration, assertion, pause, revoke, delete, recovery, renewal, the
cross-site `allow` fast path, continuous observation, and required notices without exposing
cross-site history. Identity-bound risk updates may suspend the Passport fast path immediately;
only authoritative OTP/recovery may restore it.

### Phase 23 — Agent Passport and PaidTokenPass entitlement ledger

Implement the purchased, browser/runtime-installed Agent Passport backed by the PaidTokenPass
ledger: proof-of-possession credentials, one-time/all-sites scope, quota, expiry, revocation,
idempotent consumption, refund/reversal model, versioned owner terms, cross-site `allow`, and
continuous observation. Keep its internal authority and claims cryptographically separate from
Human Passport so an agent can never impersonate a verified person. Identity-bound risk updates
may suspend paid-agent fast access without erasing ledger/audit history; restoration requires
the authoritative recovery policy.

### Phase 24 — Agent Passport purchase and installation

Integrate only a user-approved real payment rail/tool. Verify settlement before issuing the
Agent Passport entitlement and browser-installable proof-of-possession token; add
replay/refund/failure/reconciliation and hosted iframe purchase choices. Client-side payment
success alone never grants or installs a Passport.

### Phase 24A — CleanDataPage contracts and persistence

Define strict project-scoped CleanDataPage configuration/content contracts and durable
storage for multiple pages per project: server-generated serial, unique validated project
slug, independent enabled state, `free | paid` access mode, four-decimal amount plus
currency, Ad Revenue toggle, content revision, and audit metadata. Add authorized project
management APIs. Treat content as untrusted stored input and never use the route serial as
authorization.

### Phase 24B — CleanDataPage token gate and hosted surface

Build `https://powerotp.com/{projectSlug}/cleandatapage/{serialNumber}` as a
PowerOTP-hosted, safely rendered page. Require a short-lived token even for free access,
bound to project/page/audience/requesting session/nonce/expiry and kept out of URLs and
logs. Free issuance still applies abuse controls; paid issuance atomically exchanges a
valid PaidTokenPass entitlement and fails closed on replay, storage error, disablement, or
reversal. Add discovery metadata and hosted-iframe automated-access navigation without
changing the only BotBlocker decisions (`allow | otp`).

### Phase 24C — CleanDataPage dashboard and Ad Revenue

Add nested CleanDataPage rows to expanded Project cards with shared create/`+`, Edit,
enable, `free | paid` amount, and Ad Revenue controls. Collapsed cards show accessible
green/red per-page status dots and a green/gray paid-access dollar indicator. When Ad
Revenue is enabled, the OTP iframe may present a clearly labeled CleanDataPage offer to
eligible suspected bot/scraper traffic. Implement server-authoritative impression,
accepted-token-exchange, qualified-visit, reversal/fraud, reporting, and customer-revenue
accounting; client-reported clicks alone never create revenue.

### Phase 25 — Visit metering and billing

Using real gate sessions, implement idempotent monthly visitor counting and the documented
100,000-visitor allowance/block charge at the customer's tier when visitor 100,001
crosses the boundary. Reuse transactional balance/ledger and reporting patterns.

### Phase 26 — Cloudflare edge publication

Publish signed policy and rapid-list snapshots to edge storage with versions, freshness,
revocation, canary, rollback, and probes. Keep MongoDB and synchronous third-party APIs
out of the edge hot path. Publish the versioned verify lookup field only after it exists on the
authoritative `userIntelligence` row; do not publish or introduce an inbound fingerprint hash.

### Phase 27 — Global RapidAuth Worker

Implement globally distributed auth/replay checks, edge-local known decisions, unknown
escalation, signed responses, asynchronous event delivery, latency measurement, circuit
breakers, `https://api.powerotp.com` fallback, canary, and rollback without customer
reinstall. Retain at least 30 days of current user-intelligence, denylisted-IP, and
verify lookup data at the edge; authoritative full history remains on the backend. Verify is the
primary lookup when available, and unavailable or unresolved edge lookup always falls back to the
home API `userIntelligence` lookup.

### Phase 28 — Shopify integration

Use current official Shopify capabilities and the relevant Shopify skill. Implement only
gating surfaces Shopify actually permits, plus MCP generation and conformance tests.
State whole-site/action exclusions accurately.

### Phase 29 — Wix integration

Implement the supported Wix backend/extension bridge, iframe UX, MCP instructions,
credential separation, conformance tests, and explicit platform limitations.

### Phase 30 — Additional wrappers

Create one new numbered fresh-session phase per Fastify, customer Cloudflare Worker,
Netlify, WordPress, PHP, Nginx/OpenResty, or other demanded platform. Never combine
multiple wrappers in one AI context. Every wrapper reuses the protocol and conformance
suite.

### Phase 31 — Production hardening and launch

Split into fresh subphases for load/latency, direct-origin bypass and penetration tests,
false positives/appeal, privacy/legal/DPIA, accessibility, key compromise, backup/restore,
disaster recovery, incident runbooks, abuse/spend/concurrency/kill switches, SOC 2/
ISO 27001 evidence, canary cohorts, emergency bypass, rollback, and launch sign-off.

**Launch exit:** every launch criterion has evidence, an owner, and rollback; unresolved
controls remain explicitly not ready.

### Phase 32 — Optional external IP-reputation vendor add-on

Only after the core development and launch phases, select and approve a real external
IP-reputation vendor. Inventory its exact response contract, retain raw vendor payloads only in
the existing dedicated IP lookup cache, and approve a closed bounded subset before copying any
field to `userIntelligence` or registering it for operator profile scoring. Preserve typed
unavailable behavior when the vendor is absent or fails; never seed formulas, weights,
coefficients, thresholds, ranges, or defaults. Add malformed-response, timeout, replay,
rollback, omission, and scoring tests without changing exact-IP identity rules or exposing raw
vendor payloads to customers, browsers, callbacks, or MCP.

**Final roadmap exit:** the optional vendor add-on is either implemented with an approved real
vendor and full evidence, or remains explicitly deferred without blocking the launched core
product.
