# BotBlocker SOC 2 / ISO/IEC 27001:2022 control-status matrix

**POWEROTP is not SOC 2 compliant, is not ISO/IEC 27001 certified, and has not been audited.**
This matrix records, control by control, what BotBlocker's design and code *currently* do
against the criteria a future audit would examine — nothing here is a compliance claim, and no
row may be cited as evidence of certification. See
[`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`](PASSPORT_BUSINESS_AND_LEGAL_PLAN.md#5-compliance-obligations-and-artifacts)
for the roadmap and cost of an eventual real audit, and
[`AS_BUILT.md`](AS_BUILT.md) for the existing OTP-platform "SOC 2-oriented data protection"
design this matrix builds on.

## How to read this matrix

- **Implemented** — the control exists in shipped code today, with an as-built entry in
  [`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md) or the main
  [`AS_BUILT.md`](AS_BUILT.md) as evidence.
- **Partially implemented** — some real mechanism exists (often on the OTP platform BotBlocker
  will reuse) but it does not yet cover BotBlocker's own data/flows, or covers only part of the
  control's intent.
- **Planned** — designed in `POWEROTP_BOTBLOCKER_PLAN.md`/`THREAT_MODEL.md` but not yet built.
  A specific future phase in
  [`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`](POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md) is
  named wherever possible.
- **Not applicable** — the control's subject matter does not apply to BotBlocker as designed,
  with a one-line reason.

Update this matrix's status column in the same phase that changes it — never mark a control
"Implemented" ahead of the corresponding as-built entry.

## SOC 2 (Trust Services Criteria) control status

| # | Control area | Status | Evidence / target phase |
| --- | --- | --- | --- |
| CC1 | Control environment, governance, code of conduct | Partially implemented | Existing company-level governance covers the OTP platform; no BotBlocker-specific addition needed yet |
| CC2 | Communication and information (security policies published) | Partially implemented | This matrix and the threat model are the first artifacts; Phase 14's public, anonymous, read-only MCP resources (`powerotp://botblocker/docs/architecture`, `.../data-boundary`) now publish the allow\|otp decision boundary, credential/token flow, and MCP's own read-only scope to any caller, but a full published customer-facing security page remains a Phase 31 launch item |
| CC3 | Risk assessment | Partially implemented | `THREAT_MODEL.md#botblocker-threat-model` is the current risk assessment; the Phase 13 correction establishes a state-publication/customer-control boundary with no adapter/provider enforcement and explicit-only OTP DOM effects across supported wrappers, but no formal recurring risk-assessment process exists yet |
| CC4 | Monitoring activities | Partially implemented | Phase 8 adds authenticated real-state BotBlocker health and audited decision-trace surfaces; Phase 15 adds durable sanitized browser-assessment/risk-event ingestion and an `intelligence_ingestion` health dependency, while production alerting remains Phase 31 |
| CC5 | Control activities (segregation of duties) | Partially implemented | Phase 8 reuses separate customer, independent runtime-site-credential, and platform-admin boundaries; organization-level segregation remains broader than this code |
| CC6.1 | Logical access — least privilege | Partially implemented | Phases 5/8 require customer session plus project ownership for configuration/visitors/credential rotation, independent scoped site credentials for runtime routes, and platform-admin sessions for control routes; no private key or credential value is returned except one-time rotation display |
| CC6.1 | Logical access — encryption at rest for sensitive data | Partially implemented | `PII_ENCRYPTION_KEY`-based envelope encryption exists for current OTP account email (`docs/AS_BUILT.md`). Phase 21 must move authoritative account/Passport identity PII to Supabase Enterprise with per-record envelope encryption; MongoDB intelligence/`identityBindings` may retain only an opaque/keyed internal identity reference |
| CC6.1 | Logical access — encryption in transit | Implemented | The whole platform is served over HTTPS today; no BotBlocker-specific work needed |
| CC6.2 | Access provisioning/de-provisioning | Partially implemented | Phase 8 adds transactional rotation/revocation and one-active-per-site enforcement for independent BotBlocker runtime credentials; production provisioning/revocation operations are not deployed or rehearsed |
| CC6.3 | Role-based access restrictions | Partially implemented | Customer routes require customer role plus ownership; `/v1/control/botblocker/*` requires the existing platform-admin session and CSRF for mutations |
| CC6.6 | Boundary protection against external threats | Partially implemented | Phases 11–13D raw Node/Express/Next wrappers require explicit trusted-proxy configuration, bounded paths/headers/bridge bodies, and same-origin bridge controls; deployed edge controls remain later work. Phase 8A adds immutable self-validating project/site endpoint tokens, bare-404 local rejection before Valkey/MongoDB/body/authentication work, separate initial site credentials and subsequent scoped visitor tokens, and offline pass-through behavior. This is verified repository behavior, not a deployment claim |
| CC6.7 | Data transmission/removal controls | Partially implemented | Phase 6 adds explicit 18-month `retentionExpiresAt` TTL indexes for all four BotBlocker persistence categories and a separate 30-day matching-lookback constant; Phase 15's real writer applies those expiries to every session, intelligence profile, behavior report, and risk event |
| CC6.8 | Malicious software prevention | Not applicable | BotBlocker does not execute customer-supplied code; adapters explicitly "never download or execute arbitrary backend code" (`POWEROTP_BOTBLOCKER_PLAN.md`) |
| CC7.1 | Vulnerability detection | Not applicable yet | No BotBlocker attack surface is deployed; applies from Phase 8 onward |
| CC7.2 | Security incident monitoring/response | Planned | No BotBlocker-specific incident runbook exists; scheduled for Phase 31 (production hardening) |
| CC7.3 | Incident evaluation and containment | Planned | Phase 31 |
| CC7.4 | Incident response execution | Planned | Phase 31 |
| CC8.1 | Change management | Implemented | Existing repository/PR/phase-gated workflow (this development-phases document itself) applies to BotBlocker from day one |
| CC9.1 | Risk mitigation — vendor/subprocessor management | Partially implemented | Didit vendor terms are reviewed for Passport (`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §6); no other BotBlocker subprocessor exists yet |
| CC9.2 | Business continuity / disaster recovery | Planned | Phase 31 |
| A1.1 | Availability — capacity/performance monitoring | Not applicable yet | No BotBlocker service is deployed |
| A1.2 | Availability — backup and recovery | Planned | Phase 31, alongside the existing OTP-platform backup posture |
| PI1 | Processing integrity — accurate, complete, authorized processing | Partially implemented | Phases 6–13D add atomic sequence controls, request idempotency/replay rejection, scoped credential rotation, transactionally monotonic immutable policy publication, monotonic browser reports, stale/pre-OTP response rejection, trusted wrapper sequence restoration, active-OTP-over-clearance precedence, loss-safe acknowledgement, and cross-wrapper pending-to-late verified recommendation state. Phase 15 makes report/event ingestion real with transactional exact-replay idempotency, stale rejection, and scoped aggregate updates; decision processing remains Phase 16/17/20 |
| C1.1 | Confidentiality — data classified and protected | Partially implemented | Phase 10/15 sanitize browser evidence at collection: normalized click positions and bounded 32×32 pointer bins/page timing support project heatmaps without chronological trails, raw pixel coordinates, route secrets, clicked text/form values, DOM content, or arbitrary automation fields. Phase 15 revalidates closed schemas and derives query-free page URLs server-side; it persists only bounded reports, a keyed fingerprint lookup hash, and the raw trusted request IP (retained, not hashed, for site-owner visitor reporting and return-visit correlation — see the Phase 16 network-intelligence design's IP-hash reversal). Production activation and privacy launch review remain later work |
| P1–P8 | Privacy criteria (if in scope) | Planned | Full DPIA/LIA/consent-copy work is tracked in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §§3, 5, 9 |

## ISO/IEC 27001:2022 Annex A control status (representative subset)

| Annex A ref | Control | Status | Evidence / target phase |
| --- | --- | --- | --- |
| A.5.1 | Policies for information security | Planned | No published BotBlocker-specific security policy yet; company-level policy exists for the OTP platform |
| A.5.9 | Inventory of information and assets | Partially implemented | Phases 5–8 define site, credential, session, intelligence, event, challenge, and immutable policy-release assets plus indexes. Future identity assets are explicitly split between Supabase Enterprise account/identity records and MongoDB pseudonymous `identityBindings`; entitlement stores remain planned |
| A.5.15 | Access control | Partially implemented | Phase 8 adds independent hashed site credentials, exact host/site/audience binding, customer ownership, platform-admin control routes, CSRF, rate limits, idempotency, and replay controls; Phases 11–13D keep credentials behind bounded same-origin bridges and credential-free browser helpers. Phase 8A implements 30-minute project/site/session/audience token minting and validation for post-initial visitor calls and verifies that Next client chunks contain neither credential/token values nor the visitor-token field identifier; production activation remains later work. Phase 15 keeps customer/project/site scope in every session/event/intelligence read and write and rejects cross-project session-ID reuse. Phase 21 requires only authoritative account/Passport/entitlement verification to create an internal identity binding; telemetry/customer claims cannot. Phase 14's public anonymous MCP accepts no credential and reads no tenant data |
| A.5.23 | Information security for cloud services | Implemented | DigitalOcean App Platform + MongoDB Atlas + Valkey are already the OTP platform's production posture; BotBlocker reuses the same infrastructure, not new cloud services |
| A.5.31 | Legal, statutory, regulatory, contractual requirements | Partially implemented | `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §5/§10 catalogs applicable regimes and open counsel questions; not all are resolved |
| A.5.34 | Privacy and protection of PII | Partially implemented | Phase 6 enforces scoped persistence, non-unique IP observations, 18-month TTLs, and a 30-day lookup window. Phase 15 activates keyed fingerprint derivation and bounded heatmap/page analytics without browser-supplied fingerprint fields, pointer trails, page content, email/password duplication, or IP-only identity matching. The Phase 16 network-intelligence design retains the trusted request IP raw rather than hashed — it is not treated as identity/PII because it is never linked to a Supabase account record, and the raw value is needed for the site owner's own visitor report and return-visit correlation. Phase 21 must place authoritative account/identity PII in Supabase Enterprise and link MongoDB intelligence only through audited opaque/keyed `identityBindings`. DPIA/LIA and privacy-notice review remain launch prerequisites |
| A.8.2 | Privileged access rights | Partially implemented | Phase 8 BotBlocker control routes require the existing IP-allowlisted platform-admin login/session, with CSRF on mutations and audited sensitive operations |
| A.8.5 | Secure authentication | Partially implemented | Phase 3 implements strict Ed25519 helpers; Phase 7 re-verifies stored policy releases; Phase 11 locally accepts clearance cookies only after active/previous-key, audience, site, exact-session, issuance, and expiry verification and issues a returned clearance only with a separately verified `allow`; no production key/traffic is configured |
| A.8.9 | Configuration management | Partially implemented | Phase 4 adds validated Ed25519/skew service configuration; Phase 5 adds strict durable project settings; Phase 7 consumes the disabled switch, bounded timeout, key ring, immutable release head, activation window, and protocol version, but no production key/release is configured |
| A.8.16 | Monitoring activities | Partially implemented | Phase 8 adds authenticated dependency/configuration/release health and audited persisted decision traces; Phase 15 adds real immutable assessment/event history and ingestion configuration health, while production alerts and operational monitoring remain Phase 31 |
| A.8.20 | Networks security | Implemented | Existing App Platform network posture (no public ARI/AMI/DB ports, etc. — see `THREAT_MODEL.md`'s "Node compromise" section) already applies; nothing BotBlocker-specific changes it |
| A.8.23 | Web filtering | Not applicable | BotBlocker does not filter outbound web traffic for its own users |
| A.8.24 | Use of cryptography | Partially implemented | Phases 3–4 implement the separate Ed25519 trust domain, rotation/revocation/skew, validated DER configuration, and replay controls; Phase 7 signs server-side and re-verifies immutable policy releases before HTTP delivery without exposing private material, but no production key/release is configured or deployed |
| A.8.25 | Secure development lifecycle | Implemented | The phase-gated development process itself (fresh-session scoping, mandatory tests before phase closeout, explicit unavailable responses instead of fabricated behavior) is the SDLC control, effective from Phase 0 |
| A.8.26 | Application security requirements | Partially implemented | Phases 9–13D implement browser authority, sensor cadence/sanitization, signed clearance, wrapper exclusions/limits, same-origin bridges, non-interference, OTP persistence, polling, App Router navigation, and hosted iframe security. Phase 13B adds strict advisory snapshots, ordered subscription, zero automatic DOM effects, and one explicit bodyless argument-free OTP opener. Phase 13C makes raw Node the shared authority for bounded initial evidence, first-contact credential use, server-held scoped tokens, pending/late verified recommendation state, and framework-native Node/Express state. Phase 13D adds native Next request state plus an additive provider/hook while preserving customer-owned SSR, handlers, responses, streams, and rendering |
| A.8.28 | Secure coding | Implemented | Existing repository conventions (input validation via schemas, no secrets in browser bundles, parameterized queries) apply to BotBlocker code from the first line written |
| A.8.29 | Security testing in development and acceptance | Partially implemented | Phase 1–13D suites exercise deterministic transitions/timers, late OTP, stale/binding/replay rejection, fail-open versus active challenge persistence, sanitized evidence, wrapper proxy/limit/exclusion/CSRF/cookie boundaries, ordering, uploads/streams/errors/WebSockets, bridge sequencing, polling/acknowledgement, postMessage non-authority, CSP, and bundle credential absence. Phase 13B adds strict snapshot/proof/opener and zero-automatic-DOM coverage. Phase 13C adds shared Node/Express credential-token separation, pending/late state, non-interference, proxy, and same-origin coverage. Phase 13D adds native Next request-state replacement/defaults, provider/hook ordered snapshots, explicit empty OTP opening, whole-application state publication without customer-content effects, late allow/OTP propagation, customer-owned page/API/Server Action/upload/stream/error behavior, bundle token scanning, and raw Node/Express/Next conformance |
| A.8.32 | Change management | Implemented | Same as SOC 2 CC8.1 above |

## What this matrix intentionally does not claim

- It does not claim any current or pending audit engagement.
- It does not claim that "planned" or "partially implemented" rows meet any control's full
  intent — only implemented rows with as-built evidence do, and only for what that evidence
  actually covers.
- It does not extend the existing OTP platform's informal security posture into a certified
  status for BotBlocker; shared infrastructure is noted where genuinely shared, never implied
  elsewhere.
