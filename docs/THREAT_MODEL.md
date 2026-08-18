# Phase 0 threat model

Covers the OTP/telephony platform (this top-level section, written for that product's own
Phase 0) and, separately, the [BotBlocker threat model](#botblocker-threat-model) section below
for the BotBlocker product. The two sections share this file because they share infrastructure
and several controls, but "Phase 0" in a heading always refers to that product's own phase
numbering — see [`PLAN.md`](PLAN.md) for the OTP platform's phases and
[`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`](POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md) for
BotBlocker's.

## Protected assets

- Customer, admin, project, callback, provider, SIP, Spaces, and node credentials
- Phone numbers, interaction history, recordings, challenges, and correct answers
- Verification integrity, event ordering, callback authenticity, and usage balances
- Telephony availability and the ability to place paid calls or SMS

## Trust boundaries

1. Customer server to public API
2. Customer UI or hosted iframe to public API
3. App Platform services to Atlas, Valkey, and Spaces
4. Telephony agent to `https://api.powerotp.com` over HTTPS with shared
   `NODE_SECRET` bearer authentication
5. Telephony agent to localhost-only Asterisk ARI
6. Asterisk to VoIP.ms SIP trunks
7. POWEROTP API background processor to customer-controlled HTTPS endpoints
8. Public AI clients to the anonymous read-only MCP server

## Required controls

### Credential theft

- Hash project API keys; display them once and support rotation/revocation.
- Encrypt provider credentials with a master key held in App Platform.
- Keep `NODE_SECRET` only in encrypted backend configuration and the droplet service
  environment; rotate it by updating the backend and redeploying every node.
- Redact authorization, cookies, codes, tokens, SIP secrets, and answers from logs.
- Restrict platform admin login to an IP allowlist and shorter sessions; admin identity
  (email/password) lives in environment variables, not a self-service registered account.

### Unauthorized or abusive calling

- Apply project, IP, number, prefix, country, concurrency, and spend limits before queuing.
- Require an explicit consent representation and maintain suppression/deny lists.
- Permit only provider-verified outbound caller IDs.
- Add per-project and global emergency kill switches.
- Alert on unusual answer rates, destination concentration, costs, and repeated failures.

### Enumeration and privacy

- Use opaque sortable interaction IDs with sufficient entropy.
- Return stable but non-enumerating errors.
- Mask phone numbers by default and audit full-number reveals.
- Define data retention and delete or redact sensitive data on schedule.

### Replay and race conditions

- Require idempotency keys for creation.
- Bind interaction tokens to one project, interaction, action, origin, nonce, and expiry.
- Consume response tokens after accepted submission or terminal state.
- Guard every transition atomically and reject invalid or stale sequences.
- Sign callbacks with timestamp and event ID; require replay windows and idempotent handling.

### Challenge disclosure or manipulation

- Keep correct answers server-side.
- Use random option IDs scoped to one interaction and randomize option order.
- Do not expose internal recording IDs or paths.
- Cap attempts and expire/consume challenges.
- Test bundles, API payloads, source maps, logs, and MCP output for answer leakage.

### Browser and iframe attacks

- Never put project API keys in a browser or mobile bundle.
- Bind interaction tokens to allowed origins/applications.
- Validate both sides of `postMessage`.
- Send response-specific CSP `frame-ancestors`; apply CSRF and secure cookie controls.

### Callback SSRF

- Require HTTPS.
- Reject loopback, private, link-local, multicast, and cloud metadata destinations.
- Resolve and verify DNS at delivery time and after redirects; disable unsafe redirects.
- Enforce response-size, connection, and total-time limits.

### Node compromise

- Expose no ARI, AMI, MongoDB, Valkey, or customer API ports publicly.
- Use host firewall, key-only SSH, non-root agent, localhost ARI, `systemd` hardening,
  unattended security updates, and least-privilege Spaces access.
- Give a node only its assigned trunks/configuration and support immediate certificate drain
  and revocation.

### Availability and duplicate calls

- Lease work with renewal and expiry; stop assignment when heartbeats fail.
- Never assume an active call can migrate between nodes.
- Retry only where state evidence and policy make duplicate calling acceptably unlikely.
- Reconstruct queues from durable MongoDB events after Valkey loss.
- Keep local media manifests versioned and retain the previous version.

### MCP abuse

- MCP is anonymous, read-only, rate-limited, and separately deployable.
- It has no database customer access, credentials, project tools, or call/SMS execution.
- Generate its content from versioned contracts and documentation.

## Compliance gates

Before unrestricted production traffic, obtain an appropriate legal review covering
consent, TCPA/telemarketing restrictions, do-not-call handling, quiet hours, STIR/SHAKEN,
caller-ID rules, recording disclosure, privacy notices, retention, deletion, supported
countries, and provider acceptable-use requirements.

---

## BotBlocker threat model

Scope: the BotBlocker product described in
[`POWEROTP_BOTBLOCKER_PLAN.md`](POWEROTP_BOTBLOCKER_PLAN.md) and built in the order defined by
[`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`](POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md). None
of the controls below describe shipped behavior until the corresponding phase's as-built entry
in [`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md) says so.

### Additional protected assets

- Site clearance tokens, signed policy releases, and BotBlocker Ed25519 signing/verification
  keys.
- Sanitized browser/behavior telemetry, the shared `fingerprintData` records, derived risk
  signals, and scoring model inputs.
- Cross-project fraud/security intelligence and each customer's own project-scoped visitor
  data.
- Supabase Enterprise account/Passport identity records, MongoDB `identityBindings`, per-client
  pairwise pseudonyms, and the internal pepper/derivation key that links an intelligence profile
  to an opaque internal identity reference (see
  [`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`](PASSPORT_BUSINESS_AND_LEGAL_PLAN.md)).
- Customer-authored CleanDataPage content/configuration, short-lived viewing tokens,
  PaidTokenPass exchanges, and Ad Revenue accounting evidence.

### Additional trust boundaries

9. Customer browser (BotBlocker runtime sensor) to the POWEROTP decision/report API.
10. POWEROTP-hosted OTP iframe to the customer page, over `postMessage`.
11. Customer server-side Gate Adapter (raw Node HTTP, Express, or Next.js wrapper) to the
    customer's own trusted proxy/load balancer.
12. RapidAuth Global Edge (Cloudflare Workers, later) to the DigitalOcean control plane.
13. Suspected agent/bot in the hosted OTP iframe to the PowerOTP-hosted CleanDataPage token
    exchange and viewing surface.
14. Customer dashboard to project-scoped CleanDataPage configuration/content storage.

The planned primary BotBlocker rapid-check boundary is
`https://verify.powerotp.com/v1/botblocker/*`. It is not deployed yet. It will run on
Cloudflare Workers and retain at least 30 days of current user-intelligence, denylisted-IP,
and versioned verify lookup data. `https://api.powerotp.com` remains the authoritative
full-history master-data service and the required fallback rapid-check origin when the Worker is
unavailable or cannot resolve the lookup.
The Worker must preserve the existing authentication/audience semantics. Operator traffic
crosses a distinct, authenticated
`/v1/control/botblocker/*` boundary and must never be authorized by a runtime site credential.

### State-publication and customer-control boundary

POWEROTP controls recommended website state through an additive plugin protocol. Its adapters
collect approved evidence, communicate server-to-server using the customer site's credential
and visitor gate session, and publish state. Publication is the end of POWEROTP's control over
the customer application. Supported integration code does not enforce the recommendation and
cannot rewrite customer routes, suppress responses, branch rendering, or freeze customer DOM.
This is a trust boundary, not merely a packaging choice:

- Customer code may independently use or ignore advisory state under its own policy. That
  optional customer behavior is not part of the POWEROTP adapter/provider.
- POWEROTP does not verify what customer code did and cannot retract content the customer
  delivered. Product/security claims must never imply enforcement.
- Recommendation labels are fixed: checking publishes `restricted`; verified allow or fail-open
  publishes `full_access`; verified OTP publishes `otp_required`; authoritative OTP success
  publishes `full_access`. These labels cause no content/access effect and do not add a third
  backend decision.
- The 50–2,000 ms setting publishes fail-open access state on timeout/network failure. It is a
  responsiveness/availability rule, not a signed backend `allow`; pending work continues.
- A verified late `otp` updates advisory state. Customer code chooses whether to do anything,
  including whether to call the single argument-free `gate.openOtp()` API.
- Phase 13B removes the former automatic page lock. A verified `otp` changes advisory state
  only; page-lock/iframe effects, sensor pause, and polling begin only after explicit
  `gate.openOtp()` invocation. Phase 13C attaches the same closed recommendation snapshots to
  raw Node and Express request state without controlling customer handlers or responses. Phase
  13D carries that state through a replaced Next.js request-header override and exposes browser
  snapshots through an additive provider/hook. Customer code still decides whether and what to
  render, and only its explicit argument-free `openOtp()` call starts OTP DOM effects.

### API-key separation

- The site credential (`siteCredential`/`POWEROTP_SITE_CREDENTIAL`) is server-only. It must
  never appear in browser JavaScript, a public bundle, a client-visible cookie, or a
  `postMessage` payload.
- A separate, low-privilege public site identifier (`siteId`) may appear in the browser; it
  identifies the site for routing but authorizes nothing by itself.
- The server adapter uses the site credential for authenticated first RapidAuth contact/session
  creation (and separately authorized site-level configuration operations). POWEROTP mints a
  narrow visitor gate-session token for subsequent per-visitor assessment, event, challenge,
  polling, and iframe-launch operations. The browser receives neither the site credential nor
  any equivalent customer-wide authority.
- The gate-session token is short-lived, revocable, audience/site/session-bound, and held by the
  adapter. Browser requests use only the HttpOnly local session cookie; the adapter forwards
  the scoped token server-to-server. It expires after 30 minutes. At minute 29 the middleware
  sends the refresh request and replaces the rotated bearer in its server-side gate session
  without changing the session or profile binding.
- Phase 13C makes this separation explicit in the shared Node service boundary: bounded initial
  proof/evidence plus trusted request context use the site credential once, the returned opaque
  token is stored only in the server session, and later assessment, iframe-launch, and polling
  calls receive only that token. Browser bridge responses and framework request state expose
  neither value.
- Durable session storage contains only the token ID, expiry, and a one-way nonce/token digest,
  never the reusable bearer. A database read therefore cannot directly replay visitor authority.
- `gate.openOtp()` accepts no method, policy, or content selection and never accepts a site
  credential. The server derives the iframe launch from the authenticated site/session's
  authoritative `otp` decision.
- This BotBlocker opener is not the ordinary customer OTP API used for signup, password
  recovery, or other customer-initiated verification. Those flows have separate authorization
  and customer request/configuration; neither flow supplies customer-authored BotBlocker UI.
- The browser sends an empty same-origin opener request. Its HttpOnly gate-session cookie binds
  the visitor; the customer server resolves trusted site/session state and forwards the
  server-held token minted during site-credential-authenticated first contact. A gate-session
  ID, public site ID, or internal user-intelligence ID is never accepted as authorization by
  itself. Exposing the scoped token to browser JavaScript would collapse this boundary.
- Compromise of a public bundle must never be sufficient to mint a decision, forge a clearance,
  or read another site's data.

### Trusted proxy / IP rules

- Client IP is extracted only from a header explicitly configured as trusted for that specific
  deployment (e.g. a named `X-Forwarded-For` position behind a known reverse proxy count, or a
  platform-provided field such as a serverless request's connection IP). Arbitrary
  client-supplied forwarded-IP headers are never trusted by default.
- Each wrapper (raw Node HTTP, Express, Next.js) documents its own trusted-proxy configuration
  explicitly; there is no implicit "trust everything" default.
- Misconfigured trusted-proxy settings are a known false-negative/false-positive risk and must
  be covered by wrapper conformance tests before a wrapper ships.
- The Phase 11 raw Node wrapper uses the direct socket IP by default. A forwarded address is
  considered only when the deployment names the exact header, first/last chain position, and
  explicit trusted proxy IPs; wildcard trust and an omitted chain position are rejected.
- The Phase 12 Express wrapper reuses that resolver rather than trusting Express `req.ip`.
  It may additionally require an exact 1–32-value forwarded chain with
  `expectedProxyCount`; count mismatch, an untrusted direct peer, or trust-all Express
  configuration cannot authorize a forwarded value.
- Next.js 16 does not expose a socket address on `NextRequest`. The Phase 13 wrapper therefore
  omits `clientIp` and ignores forwarding headers by default. A deployment may inject only an
  authenticated direct-peer address; forwarded values then remain subject to the same exact
  header, first/last position, explicit trusted-peer IP, and optional exact-count checks.

### Replay and session fixation

- Every signed clearance, decision, and challenge token carries a nonce, issued/expiry
  timestamps, and an audience (site/session) binding; servers reject reused nonces within the
  replay window.
- Challenge tokens are one-time and consumed on first accepted use or terminal state, mirroring
  the existing OTP interaction-token pattern in `backend/packages/api/src/interaction-tokens.ts`.
- A visitor session identifier is never accepted as sufficient proof of continuity across a
  privilege change (e.g. anonymous visitor to Passport holder) without a fresh signed
  assertion; this prevents an attacker from fixating a pre-verification session ID and
  inheriting a later-verified visitor's clearance.
- The persistent `powerotp_site_return` cookie is a signed, HttpOnly, site-scoped credential bound
  to one `userIntelligence` row, not to one gate session. It grants immediate local access on a
  repeat visit while a fresh/active session begins reporting. Expiry, deletion, signature
  failure, or authoritative revocation removes that fast path, and later session updates may
  revoke access or require OTP. `powerotp_gate` remains active-session state and
  `powerotp_access` remains short-lived session clearance; neither substitutes for the return
  credential.
- `userIntelligence` remains the behavior/risk profile before and after identification. Only an
  authoritative verified account/Passport/paid-entitlement flow may create or change its
  `identityBindings` association; browser telemetry and customer-supplied user IDs cannot.
  MongoDB receives only an opaque/keyed identity reference, while email, password/
  authentication hashes, verified attributes, and other identity PII remain in Supabase
  Enterprise.
- Every accepted session report may update the intelligence profile and, once scoring exists,
  rerun its authoritative score. A threshold change may issue a newer signed `otp` decision and
  suspend identity-bound Passport/PaidTokenPass fast access. A browser or middleware-generated
  suspicion is evidence only and can never freeze credentials or author a decision by itself.
- `openOtp()` never accepts a caller-supplied session ID. Duplicate/malformed cookies fail
  validation, and the server-side session lookup plus scoped token claims must agree on
  site/session/audience before POWEROTP reads the related user-intelligence record.
- The raw Node wrapper stores an opaque 192-bit session ID in an HttpOnly/SameSite cookie,
  keeps initial evidence, scoped visitor authorization, recommendation ordering, and challenge
  state server-side, and never evicts an active OTP challenge from its bounded default store.
  Authoritative verification remains active server-side until the browser acknowledges
  applying the bound polling result.
- Express composes that same server-side store and bridge. Its default remains process-local;
  clustered or multi-instance deployments require an injected concurrency-safe shared store
  and cannot claim active-OTP durability from the default.
- Next.js composes the same store and bridge in Node-runtime Proxy and App Router handlers.
  Its default is also process-local; serverless/multi-instance deployment requires an injected
  bounded concurrency-safe store before it can claim active-OTP durability.

### Forged clearance and signed policy

- Clearances and policy releases are Ed25519-signed by POWEROTP; adapters hold only public
  verification keys, never signing keys.
- Adapters reject any clearance or policy that fails signature verification, fails schema
  validation, targets a different site audience, or attempts an unauthorized version rollback.
- A valid clearance cannot override an active server-side OTP challenge, including when the
  clearance was issued earlier and remains otherwise unexpired.
- Key rotation maintains an active/previous key overlap window (Phase 4) so a rotation cannot
  itself cause a denial-of-service by invalidating everything atomically.
- A compromised policy-publication path is treated as a full incident: canary rollout and
  signed rollback exist specifically to bound the blast radius of a bad or malicious release.

### Iframe / postMessage authority

- Customer code explicitly calls the one argument-free `gate.openOtp()` API after receiving an
  `otp` recommendation. POWEROTP validates the site/session decision and selects the OTP method
  and iframe content server-side after resolving the gate-session-to-user-intelligence
  relationship; caller-supplied IDs, method/content overrides, and non-empty opener bodies are
  rejected.
- The hosted OTP iframe is the only source of an authoritative "verified" state. A
  same-window/opener `postMessage` from the customer's own page script is never treated as
  authoritative, exactly as already documented for the existing widget in
  [`AS_BUILT.md`](AS_BUILT.md) ("the postMessage relay is a UX convenience, never
  authoritative").
- The adapter independently confirms verification status against the server (polling or a
  signed callback) before publishing verified state; it never treats a `postMessage` event
  alone as authorization.
- `postMessage` payloads are validated for expected origin and shape before use; the customer
  page's own script is treated as untrusted for this purpose since anything else running in
  that browser tab can also post messages.
- Response-specific CSP `frame-ancestors` restricts which origins may embed the hosted iframe.
- The raw Node bridge requires a non-simple same-origin marker plus Fetch Metadata/Origin
  checks before session creation. Iframe messages can only trigger its authoritative poll;
  the server retains OTP state if the poll response or browser acknowledgement is lost.

### Continuous decision revisions

- Because a visitor can move from `allow` to `otp` at any time (initial evaluation, 30-second
  report, or partial report), every decision carries a monotonic sequence/issuance time so a
  stale cached "allow" cannot be replayed to suppress a later "otp".
- The adapter and browser sensor must apply the most recent valid decision they have observed,
  never a locally cached older one, and must reject a decision with an older sequence number
  than one already applied for that session.
- Pausing customer-page monitoring after the customer explicitly opens the OTP iframe must not
  create a window where a stale pre-OTP decision is reapplied; monitoring resumes only in a
  fresh interval after authoritative success.

### Fail-open timeout / network behavior

- The browser SDK publishes fail-open access state on both the decision timeout and
  RapidAuth/network failure. Customer code decides whether that state opens its UI. This is an
  explicit product decision (see
  [`POWEROTP_BOTBLOCKER_PLAN.md`](POWEROTP_BOTBLOCKER_PLAN.md#failure-and-security-rules)), not
  an oversight, and must be documented to customers as such.
- A locally valid, unexpired, correctly signed clearance remains usable during control-plane
  outage.
- Fail-open state must never overwrite an already-issued `otp` decision or an in-progress
  challenge; those recommendations/states persist across outages.
- Customers requiring fail-closed behavior implement it in their own server/client access
  logic. POWEROTP reports state but does not enforce it.
- The Phase 13C raw Node wrapper invokes the protected application handler immediately with
  framework-native advisory state. Only its owned bounded bridge starts first contact after
  initial evidence is present. Timeout publishes fail-open while the same Promise remains
  pending, and a late verified `allow` or `otp` replaces that state. Its bounded session store
  may fail open for a new ordinary visitor at capacity but pins every active OTP challenge.
- The Express wrapper delegates to that same Node authority without reading application
  JSON/multipart bodies, rewriting routes, or buffering/mutating streams and compressed HTML.
  Its React helper remains advisory: it changes no DOM until customer code explicitly calls
  `openOtp()`.
- The Next.js 16 wrapper returns `NextResponse.next()` without reading protected page/API/
  Server Action or upload bodies, and retains the pending decision with
  `NextFetchEvent.waitUntil()`. Owned App Router bridge handlers alone read bounded JSON;
  WebSocket upgrades, framework/static assets, health/infrastructure paths, and `OPTIONS` do
  not create gate sessions. Proxy replaces any inbound POWEROTP request-state header with the
  shared Node authority's server-authenticated bounded recommendation/session state for
  downstream App Router code; missing, malformed, or modified state is typed unavailable rather
  than fabricated allow.
- The root Next.js provider uses the Phase 13B `getSnapshot`/`subscribe` contract and survives
  App Router navigation. It does not rewrite, redirect, buffer, inject, suppress rendering, or
  open an iframe. The fixture requests advisory state for the whole customer application but
  always renders customer content untouched. The provider only reports state and exposes
  argument-free `openOtp()`; customer code alone decides whether to act on either.

### Direct-origin bypass

- Any adapter that runs at the application layer (Express, Next.js, raw Node HTTP) observes
  only requests that reach that process. If the customer's origin is directly reachable
  (bypassing a CDN/WAF or the adapter process itself), BotBlocker cannot observe that traffic
  or publish state for it.
- This is a known, customer-configuration-dependent limitation, not something BotBlocker can
  fully close from inside the customer's own infrastructure. Wrapper documentation and MCP
  installation output must state it plainly and recommend the customer restrict direct origin
  access at their own network/CDN layer.
- Later Cloudflare-edge/customer-owned-Worker adapters improve request-path coverage but do not
  change the state-publication/customer-control boundary. Any customer-owned edge behavior is
  independent customer policy, not POWEROTP enforcement.

### Cross-project data access

- All BotBlocker read APIs (`GET /v1/projects/{projectId}/botblocker/visitors`, dashboard
  queries, MCP-facing documentation) are scoped by `projectId` and the caller's authenticated
  session, exactly like existing project-scoped OTP endpoints.
- A customer can query only observations that belong to their own project(s). Internal
  cross-site fraud/security correlation (device/network reputation, blacklist provenance) is a
  private, server-side signal that may *influence* a decision surfaced to a customer's project,
  but the underlying cross-site evidence, other customers' visitor identities, and other
  projects' raw events are never returned to any customer, admin dashboard scoping bugs
  notwithstanding — this must be covered by an explicit cross-tenant-isolation test before
  Phase 15/16 ship.
- No API ever accepts a caller-supplied `projectId` without verifying the authenticated
  caller's ownership of that project first.
- Phase 15's ingestion scope is taken from the authenticated site credential, never from a
  report-level ownership claim. Session lookup, sequence advancement, immutable event writes,
  intelligence updates, visitor lists, and report/event lists all include
  `customerId`/`projectId`/`siteId`; reuse of another project's gate-session ID is rejected
  without creating or returning that project's record.

### Site-scoped webhook endpoint routing

Phase 8A corrects a gap in the original Phase 8 central API surface: every runtime route
originating from real website visitor traffic (`rapid-auth`, `browser-assessment`,
`risk-events`, `challenges` create/read/complete, `passports/register`, `passports/assert`,
`paid-passes/assert`, `agent/entitlements`) previously shared one fixed, unscoped global URL per
operation, distinguished only by the Bearer site credential in the request body/header. Because
this platform is fail-open by design — a decision timeout or unreachable backend must never
block the customer's site — an attacker who can cheaply flood a fixed global runtime URL gains a
correspondingly cheap way to degrade rate limits, database capacity, or availability shared
across every customer at once, without needing to know any customer's credential first.

- Project creation generates the project/API key/site/endpoint/signing secret/audits in one
  MongoDB transaction. The signing secret is independently random and encrypted at rest. Any
  failed write aborts the transaction; no cleanup hook, migration, or backfill is used.
- Every route above requires an immutable `bwh_<signed-payload>.<hmac>` endpoint token. The
  signed payload includes format version, random endpoint ID, project ID, and site ID. Strict
  length/character validation and constant-time HMAC comparison use a dedicated server secret.
- Malformed or forged paths receive a bare 404 before server-context loading, Valkey/rate-limit
  access, MongoDB resolution, body parsing, site-credential authentication, visitor-token
  authentication, nonce/idempotency, or business logic. A locally valid token then resolves only
  its exact project/site/endpoint record.
- The site credential authenticates only initial visitor-session creation. PowerOTP returns a
  30-minute project/site/session/audience-bound visitor token; subsequent visitor operations
  require it. Replaying another project's credential or token against this endpoint fails scope
  validation.
- Inactive project/site resolution returns typed `offline` before authentication or ingestion.
  The adapter remains pass-through, stops ordinary reports/decisions, and uses bounded readiness
  polling. Neither `offline` nor `fail_open` is an `allow` decision.
- A dashboard-authenticated call the customer's own backend makes directly (project
  configuration, credential rotation, project-scoped visitor listing) is a different traffic
  class and is unaffected — it remains protected by the existing customer session, CSRF, and
  project-ownership checks, not by URL scoping.
- `GET /v1/botblocker/policy/{siteId}` is intentionally unaffected: it is already a public,
  anonymous, cacheable read scoped by the low-privilege public `siteId`, with no credential to
  protect and no fail-open flood-amplification risk of its own.

### CleanDataPage access, content, and revenue integrity

- A CleanDataPage URL identifies a project/page but authorizes nothing. Every request requires
  a short-lived token bound to the exact project, page, audience, requesting session, nonce,
  issuance, and expiry; tokens are not placed in URLs, referrers, analytics, or logs.
- Free access still receives a scoped token and remains rate/abuse limited. Paid access requires
  a server-verified, atomically consumed PaidTokenPass entitlement. Client-declared payment,
  iframe rendering, a click, or possession of a serial number never proves entitlement.
- Token issuance and use fail closed on replay-store failure, expiry, page disablement,
  cross-project/page mismatch, paid reversal, or entitlement-consumption failure. Disabling a
  page must invalidate access server-side rather than waiting only for token expiry.
- Customer-authored titles/content are stored input from an untrusted tenant. Management APIs
  enforce project ownership; hosted rendering applies schema/type/size limits, output encoding,
  restrictive CSP, and no arbitrary script execution. Cross-tenant isolation tests cover both
  management and hosted reads.
- The Ad Revenue toggle makes an offer eligible for display in the automated-access lane; it
  does not weaken OTP, create a third decision, or grant access. Revenue qualification uses
  server-side impressions, accepted token exchanges, qualified visits, and reversal/fraud
  records. Client-reported clicks alone are untrusted, and self-click, replay, automation, and
  customer/visitor collusion are explicit abuse cases.
- Prices use a validated currency plus decimal-string or integer-minor-unit representation,
  never binary floating point. Price/content revisions are versioned so an access exchange is
  auditable against the exact terms accepted.

### Behavior telemetry, fingerprint evidence, and prohibited data

Behavior reports are bounded at the point of collection before leaving the visitor's browser.
Browser/device fingerprint evidence is a separate versioned input with its own closed schema:

| Allowed | Prohibited |
| --- | --- |
| Route path plus a server-derived absolute page URL, always with query string and fragment stripped | Full URL with query string/fragment |
| Explicit `data-powerotp-page-id`/`data-powerotp-page-name`, interval duration and visible/active duration, document dimensions, and sanitized navigation target path | Automatically scraped document title, DOM text/content, history state, query parameters |
| Click element category, explicit `data-powerotp-id`, and document-normalized `xRatio`/`yRatio` | Clicked text, form values, arbitrary CSS selectors, raw absolute pixel coordinates |
| Mouse directness/straight-line metrics plus sparse client-aggregated 32×32 pointer bins (`sampleCount`, bounded `dwellMs`) | Chronological/raw mouse coordinate trails or every pointer event |
| Scroll smoothness / high-speed aggregate metrics | Raw scroll trails |
| Honeypot/decoy activations | — |
| Versioned behavior-sensor metadata and fixed-enum `webdriver`/untrusted-event indicators | Arbitrary unversioned browser-property scans or raw event details |
| Versioned, bounded browser/device fingerprint components: UA Client Hints, browser/platform/architecture, screen/device/hardware properties, languages/timezone, supported capabilities, canvas, WebGL, AudioContext, and font outputs | Browser/library-supplied identity authority, arbitrary extension data, unbounded component values |
| Timing (5s initial, 30s recurring, partial-report triggers) | Raw keystrokes, passwords, emails, DOM snapshots, page content |

Any new behavior or fingerprint field must be assigned to the correct versioned closed contract
and checked against this table before it ships. Fingerprint collection does not permit page
content, form values, passwords, raw keystrokes, clicked text, chronological pointer trails, or
unbounded arbitrary properties.
This mirrors the existing rule that PowerOTP's OTP platform never logs answers, tokens, or
secrets (see [Enumeration and privacy](#enumeration-and-privacy) and
[Challenge disclosure or manipulation](#challenge-disclosure-or-manipulation) above).

The Phase 15 analytics correction deliberately keeps enough bounded evidence for project-owned
click/pointer heatmaps, page-time charts, and navigation-flow reports. It aggregates pointer
movement in the browser before transmission and retains normalized click points, so the
backend can generate an overlay for a current page without storing a replayable cursor trail.
The future viewer opens the server-derived `audience origin + sanitized routePath` URL; it never
uses a browser-supplied full URL or query string. Page labels are opt-in customer-authored
`data-powerotp-page-*` attributes, not scraped content.

The target authoritative ingestion service applies the same strict schemas before opening a
session or writing an event. The complete first middleware request is retained as the session
snapshot and initial immutable risk event, including available trusted IP, browser/fingerprint,
request, proof, and risk data. MongoDB transactions bind every report/event to the authenticated
customer/project/site and gate session, advance only a strictly newer per-session sequence, and
return an exact replay as an idempotent duplicate rather than writing it twice. A conflicting or
older sequence is rejected. Gate-session headers and linked behavior/risk-event inputs use
90-day TTLs. The aggregated `userIntelligence` profile refreshes its 548-day TTL from accepted
activity.

Inbound fingerprint and IP values are retained raw and are never hashed for ingestion or home
matching. Fingerprint material is a separate broad, bounded, versioned browser/device vector
collected once per new gate session through exactly pinned
`@fingerprintjs/fingerprintjs` v5.2.0 with monitoring disabled and mapped into POWEROTP-owned
contracts. The library visitor ID and confidence result are discarded. Component failures are
reduced to bounded typed availability; arbitrary raw collector errors are not retained.

The full current vector is stored in the shared `fingerprintData` collection, one 548-day record
per `userIntelligence` profile. It is replaced by a newer accepted gate session and is not copied
wholesale onto the hot profile row, emitted every five/30 seconds, or retained as historical hash
aliases. Only the approved selected latest-successful fields are synchronized to
`userIntelligence`; a missing newer component cannot erase a prior successful selected value.
During `userIntelligence` creation/update, the server writes the approved comparatively stable
source fields to the row and derives an HMAC-SHA-256 from those row values under the independent
`BOTBLOCKER_INTELLIGENCE_HASH_SECRET`. The one versioned result is stored on that row for
verify-server publication.
Changing browser/OS versions, timezone, language order, window/frame geometry, privacy
preferences, storage state, behavior evidence, and IP are excluded from that verify hash but may
remain bounded evidence.

The trusted request IP is retained raw (not hashed): it is not treated as identity/PII because it
is never linked to a Supabase account record, and the platform's own design explicitly needs the
raw value for two purposes — showing it in the site owner's own visitor report, and using it as a
security/correlation signal. Home profile selection uses the signed user-intelligence-bound
site-return cookie or authoritative Passport first, then exact raw-fingerprint comparison when
neither exists. IP alone never establishes or merges identity. When a later accepted profile
update changes the user-row-derived verify lookup value, replace that row's current field without
aliases. There is no fuzzy, closest-match, partial-hash, subnet-identity, or IP-only identity path.

Each profile keeps the current exact trusted IP and a unique LRU of at most 20 prior IPs. Each
entry carries only that observation's optional configured ASN score and explicit dedicated
exact-IP blacklist result; decision status is never used to infer blacklist membership. A same-IP
observation refreshes current values without appending history. An IP change moves the outgoing
current entry to newest history, removes duplicate occurrences, and trims the least-recent entry.
No per-IP timestamps, observation counts, reuse counts, historical ASN averages, or blacklist
ratios are persisted.

Profiles also keep separate distinct-profile reuse counts for the current exact IP across all
websites and within the same website for the latest 1, 7, and 30 days. Scoring may transiently
derive prior-IP count, prior ASN average, configured blacklist calculations, and those six reuse
counts. An empty history has a real count of zero, while averages/ratios are unavailable rather
than divided by zero. IP history and counts are risk inputs, not identity authority; they do not
automatically flag or blacklist an IP. CGNAT-private addresses are not observable at POWEROTP,
and IPv4/IPv6 family is a lookup/storage distinction, not risk by itself.

Fingerprint/session synchronization is applied at most once per accepted gate session in one
MongoDB transaction scoped to customer/project/site/session. The transaction conditionally marks
application, updates only the linked `fingerprintData` and `userIntelligence` rows, refreshes
retention, and commits before scoring or callback use. Server observation time and a deterministic
gate-session-ID tie-breaker prevent stale overwrite; exact replay is a no-op, concurrent IP
changes cannot lose an accepted update, and database failure leaves no partial synchronization.

Detailed `riskEvents` behavior mapping remains a separately approved future reducer. External
IP-vendor profile/scoring fields also remain deferred until a real vendor and bounded field set are
approved; raw vendor payloads remain in the vendor cache. Missing fields from either source are
omitted from scoring and never block the evaluator or callback path.

### Public MCP generator

Phase 14 implements the `backend/packages/mcp` BotBlocker resources/tools referenced in
[`POWEROTP_BOTBLOCKER_PLAN.md`](POWEROTP_BOTBLOCKER_PLAN.md#public-mcp-instruction-system) and
in the ["MCP abuse"](#mcp-abuse) control above, which already required MCP to stay anonymous,
read-only, and rate-limited/separately deployable.

- Every BotBlocker MCP tool accepts a strict Zod-validated input (an adapter enum and, for one
  verification tool, a caller-supplied checksum string) and never a credential, token, project
  ID, or account identifier. No tool reads a database, a customer's account, or another
  customer's data — there is nothing for it to read; the generator only assembles static,
  versioned template content and computed checksums.
- Generated `node-http`/`express`/`nextjs` file content references only environment-variable
  *names* (`POWEROTP_SITE_ID`, `POWEROTP_SITE_CREDENTIAL`,
  `POWEROTP_VERIFICATION_KEY_ID`/`_PUBLIC_KEY_SPKI_BASE64`, and their optional previous-key
  rotation counterparts) through `process.env.*` reads. `manifest.test.ts` asserts no file
  contains a literal credential-shaped value, a PEM private-key header, or a customer-hosted
  CleanDataPage/`aisummary` route, and that the three adapters' manifests are distinct and
  independently checksummed.
- The generator performs no account management, deployment, repository mutation, dashboard
  mutation, or hosting configuration; it returns text and JSON for the caller's own AI/developer
  to apply. It cannot install anything, run anything on the caller's infrastructure, or
  authenticate as anyone.
- Because self-service dashboard issuance of a BotBlocker site credential and verification key
  pair does not exist yet (Phase 5 deliberately created none), the generator's own environment-
  variable guidance states that plainly rather than describing an unbuilt provisioning flow —
  MCP output must never claim a capability the rest of the product has not shipped.

This document is an engineering threat model, not legal advice.
