# BotBlocker as-built log

This is the ground truth of what actually exists for the BotBlocker product right now — one
dated entry per completed phase from
[`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`](POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md).
[`POWEROTP_BOTBLOCKER_PLAN.md`](POWEROTP_BOTBLOCKER_PLAN.md) describes the intended product and
architecture; this file describes what has actually been built, tested, and (if applicable)
deployed, so a fresh session never has to reverse-engineer it from commit history.

Only high-level architecture, infrastructure, or deployment-shape changes get mirrored into the
main [`AS_BUILT.md`](AS_BUILT.md) — most BotBlocker detail belongs only here.

**Do not backfill an entry for work that has not happened.** Every entry below reflects a
phase that was actually executed and verified in this repository. Planned-but-not-built
behavior belongs in `POWEROTP_BOTBLOCKER_PLAN.md`/`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`,
never here.

## Current status

BotBlocker is **not active for any real customer**. Phases 1–8 provide strict protocol and
API contracts, an independent Ed25519 trust domain, disabled project/site configuration,
durable scoped persistence boundaries, immutable signed policy publication/delivery, and the
complete authenticated central HTTP surface. Runtime site credentials use an independent
hashed credential domain. Phase 15 makes browser-assessment and risk-event ingestion real while
unimplemented scoring remains typed unavailable rather than fabricating a score, challenge
result, Passport result, or paid entitlement. Phase 16 makes one visitor-facing decision real:
an active exact-IP blacklist match produces `otp`; otherwise the decision remains typed
unavailable while the session stores its resolved ASN/type score and optional vendor-reputation
snapshot.

Phases 9–13 add the framework-neutral browser gate and continuous sanitized sensor plus raw
Node HTTP, Express 5, and Next.js 16 App Router wrappers. The wrappers verify signed clearances
locally, keep site credentials server-only, expose bounded same-origin bridge routes, and
default every unbacked central capability to typed unavailable. The framework packages add
credential-free React root helpers without rewriting application streams or uploads; the
Next.js wrapper also provides native Node-runtime Proxy handling and App Router/discovery
handlers. Phase 15 historically added transactional, project-scoped visitor sessions,
server-keyed fingerprint matching, immutable sanitized behavior reports/risk events, strict
sequence/idempotency handling, and the shipped 548-day retention behavior. Phase 17 now
supersedes that inbound-hash matching path with raw fingerprint persistence and exact raw
comparison. IP remains raw and is never identity authority. The corrected analytics contract also
retains normalized click positions, bounded
32×32 pointer-density/dwell bins, explicit page ID/name, active/total page time, navigation
targets, and a server-derived query-free page URL for future project heatmap and navigation
reports. Phase 16 adds dedicated raw-IP blacklist tables, IPv4/IPv6 network-range lookups, ASN
classification/type-score configuration, and IPv4/IPv6 external-reputation caches. There is
still no proprietary profile scoring, customer score/OTP policy, OTP orchestration,
Passport/PaidTokenPass implementation, billing/metering, production BotBlocker key, policy
release, deployment, or traffic activation.

**Approved design corrections partially built.** The Phase 17 fingerprint contracts,
once-per-gate-session browser collector, raw `fingerprintData` persistence, bounded
`userIntelligence` stable-source projection, and same-row versioned verify lookup derivation are
shipped. The Phase 17 design in
`POWEROTP_BOTBLOCKER_PHASE17_PROPRIETARY_SCORING_PLAN.md` supersedes several earlier design
assumptions without rewriting their historical as-built entries. Current backend ingestion no
longer derives or stores an inbound fingerprint hash: it persists the raw vector, uses only exact
raw comparison as the non-authoritative home fallback, and stores the sole fingerprint-derived
hash on `userIntelligence` after projecting its approved row values. It still does not write the
complete initial request as the first risk event, has no persistent
user-intelligence-bound return cookie, does not refresh the 30-minute visitor token at minute 29,
and still applies 548-day TTLs to sessions/risk events. The approved target keeps inbound IP and
fingerprint data raw; binds through the signed site-return cookie, Passport, or exact raw
fingerprint; stores only safe token metadata on the durable session row; has middleware store the
bearer and initiate/replace it on minute-29 refresh; derives the one versioned verify lookup hash
from the stable-source values during `userIntelligence` row creation/update; uses verify as primary with the home
`userIntelligence` lookup as fallback; changes session inputs to 90-day TTLs; aggregates accepted
inputs; calculates the current `0..100` score; and notifies middleware through the signed
callback/pull flow. Those remaining target persistence and runtime corrections are not claimed as
implemented here.

The Phase 13 correction establishes a strict state-publication boundary. Middleware uses the
site credential for first session contact and narrow server-held visitor tokens thereafter,
then publishes advisory state for every customer application request except fixed technical
exclusions. Neither adapter nor provider enforces, blocks, hides, branches, or renders customer
content. Customer code alone decides whether and how to use the state or explicitly call the
one argument-free OTP opener. Phase 13B provides the strict advisory browser snapshot/state API
and removes automatic page-lock/iframe effects.
Phase 13C makes gate-node the shared raw Node/Express authority, and Phase 13D completes
authenticated Next.js request state plus the additive App Router provider/hook. The three
supported wrappers now pass cross-wrapper conformance, so Phase 14 may publish integrations.
`enabled: true` remains only stored preference and is insufficient for readiness. The existing
hosted-widget bot-signal honeypot and `/v1/projects/{projectId}/visitors` OTP dashboard route
remain separate from BotBlocker.

Phase 14 adds the public, anonymous, read-only, credential-free BotBlocker MCP generator:
architecture/data-boundary resources plus versioned, checksummed node-http/express/nextjs
integration-manifest tools built directly from the shipped Phase 13B–13D APIs. It adds no new
backend service and does not itself unblock activation — self-service dashboard issuance of a
site credential and verification key pair still does not exist (see Phase 5), so MCP's own
environment-variable guidance says so rather than describing an unbuilt dashboard flow.

## Phase log

### Phase 0 — Reconcile specification and threat model (2026-08-11)

**Outcome.** Documentation-only phase. Reconciled the BotBlocker product plan, the BotBlocker
threat model, and the Passport/legal design with the optimistic-load architecture summarized in
`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`'s "End goal" section, and created this file plus a
SOC 2/ISO 27001 control-status matrix. No code, contracts, or infrastructure changed.

**Architecture decisions/clarifications recorded this phase:**

- BotBlocker's default is optimistic loading: the customer's site is never blocked on a
  PowerOTP decision. The customer-configured 50–2,000 ms (200 ms recommended) value is a UX
  responsiveness timeout, not a security boundary; a decision that resolves after the timeout
  still applies, including freezing an already-open page for a late `otp`.
- Documented, as a permanent and load-bearing statement (not a defect to be fixed later): a
  late `otp` decision cannot retract customer content already delivered to the browser before
  that decision arrived. This is the "optimistic-load limitation."
- The visitor-facing decision space is exactly `{allow, otp}` everywhere in the protocol —
  removed lingering references in `POWEROTP_BOTBLOCKER_PLAN.md` that implied a third
  "monitor"/"browser_check" decision outcome (those remain internal policy configuration
  inputs, not outcomes).
- `POWEROTP_BOTBLOCKER_PLAN.md` previously contained its own embedded Phase 0–12 execution list
  and a "Phase handoff rules" section that both contradicted the newer, canonical Phase 0–31
  list in `POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md` (different numbering, different scope per
  phase). Removed the duplicate list and handoff rules from the plan; the phases document is
  now the single canonical execution order and handoff-prompt format.
- Named the three initial TypeScript/Node/React wrappers explicitly as sharing one protocol:
  raw Node HTTP (`libraries/gate-node`), Express (`libraries/gate-express`), and Next.js
  (`libraries/gate-next`), all over `libraries/gate-core` and
  `backend/packages/contracts/src/botblocker.ts`. Previously the plan named only an Express reference
  implementation and listed Next.js separately under "Later adapters" — corrected the
  contradiction; Next.js is one of the three initial wrappers.
- Reconciled the customer-curated agent-content path: `/powerotp/aisummary` (introduced in
  `POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`'s Phase 11/13) is the customer-authored content
route the wrapper scaffolds; `/.well-known/powerotp-agent` is a discovery pointer to it. Both
are explicitly distinguished from the unrelated, already-shipped bot-signal honeypot route
`GET /v1/modal-sessions/{sessionId}/ai-index-summary`.
- Clarified in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` that BotBlocker's internal cross-site
  fraud correlation (server-side only, keyed by device/network evidence for anonymous traffic
  or `HMAC(pepper, user_id)` for Passport holders) is a distinct mechanism from the per-site
  Passport pseudonym `HMAC(pepper, user_id || client_id)` exposed to customer sites. Neither is
  ever delivered as a cross-site cookie, and no network-global identifier is ever exposed to a
  customer.
- Added a "BotBlocker threat model" section to `THREAT_MODEL.md` covering the optimistic-load
  limitation, API-key separation, trusted-proxy/IP rules, replay/session-fixation, forged
  clearance/signed policy, iframe/postMessage authority, continuous decision revisions,
  fail-open timeout/network behavior, direct-origin bypass, cross-project data access, and the
  sanitized-telemetry/prohibited-data table.

**Exact files changed:**

- `docs/POWEROTP_BOTBLOCKER_PLAN.md` (substantially revised: Purpose, Product invariants,
  System flow, Gate Adapter, Signed Policy Client, Browser Gate Shell and Runtime Sensor,
  PowerOTP Passport, Agent content and payments, Initial platform adapters, API surface,
  Failure and security rules, Development phases; removed the duplicate embedded phase list and
  handoff-rules section)
- `docs/THREAT_MODEL.md` (added the "BotBlocker threat model" section and a scope note at the
  top distinguishing the OTP-platform section from the BotBlocker section)
- `docs/PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` (added the "BotBlocker's internal fraud
  correlation vs. the Passport pseudonym" subsection)
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md` (new — this file)
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md` (new)

**Migrations.** None — documentation only.

**Configuration and environment variables.** None introduced. No BotBlocker environment
variable exists yet; `PASSWORD_PEPPER`, `PII_ENCRYPTION_KEY`, and `EMAIL_LOOKUP_HASH_SECRET`
referenced in this phase's session context are existing OTP-platform account-security
variables (see `infrastructure/app-platform/README.md`), not BotBlocker variables.

**Tests and results.** No code changed, so `npm run verify` was not run (out of scope per this
phase's explicit instructions). Manual checks performed and passing:

- Re-read every cross-reference introduced across `POWEROTP_BOTBLOCKER_PLAN.md`,
  `THREAT_MODEL.md`, `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`,
  `POWEROTP_BOTBLOCKER_AS_BUILT.md`, and `POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
  and confirmed each `[label](path#anchor)` link's target file exists and its anchor matches an
  actual heading's GitHub-slugified form.
- `git diff --check` — clean, no whitespace errors.

**Manual production/deployment steps.** None. This phase shipped no code and requires no
deployment action.

**New findings / changes to the plan.**

- The existing embedded "Development phases" section inside `POWEROTP_BOTBLOCKER_PLAN.md` had
  silently drifted from the newer, more detailed `POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`
  (12 phases vs. 31, different scope boundaries per phase). Any future session that reads only
  `POWEROTP_BOTBLOCKER_PLAN.md` without also reading the phases document would have followed
  the wrong, superseded execution order. Resolved by deleting the duplicate from the plan.
- `docs/AS_BUILT.md` already documents a "Threat score: Coming soon" dashboard column and the
  bot-signal honeypot; these are pre-existing, unrelated to this phase's scope, and were left
  untouched per the "only make changes that are requested or well understood" rule.

**Unresolved risks / open questions carried into later phases.**

- The exact wire format for `allow`/`otp` decisions, browser reports, and error contracts is
  not yet defined — that is Phase 1's job.
- No cryptographic primitive exists yet; every "signed clearance"/"signed policy" statement in
  the plan and threat model is a design requirement for Phase 3 onward, not implemented
  behavior.
- The SOC 2/ISO 27001 control matrix created this phase necessarily marks nearly every control
  "planned," since no BotBlocker code exists. It must be revisited every phase that implements
  a control it names.
- Business/legal decisions in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` (Didit carve-out, pricing,
  DPIA, counsel questions in its section 10) remain open and are unaffected by this phase's
  purely technical-terminology reconciliation.

**Phase 1 prerequisites.** None outstanding from Phase 0 — Phase 1 (Base protocol contracts)
may start from a fresh session once this entry and the closeout below are recorded, per
`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`.

### Phase 1 — Base protocol contracts (2026-08-12)

**Outcome.** Added the first BotBlocker code in the repository: a new, standalone contracts
module (`backend/packages/contracts/src/botblocker.ts`) defining versioned protocol identifiers, the
50–2,000 ms (200 ms default) decision-timeout contract, adapter/request-context types, the
sanitized browser-evidence contract, first/recurring/partial behavior-report contracts with a
report sequence/staleness helper, a decision-revision *envelope* (no `outcome` field — that is
Phase 2's job), and stable typed error/unavailable-response contracts. No route, middleware,
wrapper, or persistence was added — this phase is contracts only, exactly as scoped. Nothing in
the rest of the codebase imports these exports yet.

**Architecture decisions/clarifications recorded this phase:**

- Followed the existing `backend/packages/contracts/src/*.ts` convention exactly: zod schemas named
  `XxxSchema`, `as const` string-union arrays for enums, and `z.infer`-derived exported types at
  the bottom of the file (see `verification.ts`, `projects.ts`, `nodes.ts` for the established
  pattern this file matches).
- Every browser-evidence-related schema (`ClickObservationSchema`, `MouseDirectnessSchema`,
  `ScrollBehaviorSchema`, `HoneypotActivationSchema`, `BrowserEvidenceSchema`, and every
  behavior-report schema, `RequestContextSchema`, `DecisionRevisionEnvelopeSchema`, and both
  error/unavailable schemas) uses zod's `.strict()` so an unlisted field is rejected at parse
  time, not just omitted from the TypeScript type — this is what makes the prohibited-field
  tests meaningful at runtime, not only at compile time.
- `DecisionRevisionEnvelopeSchema` mirrors the audience/nonce/issued-and-expiry-timestamp shape
  of the existing `InteractionTokenClaimsSchema` pattern in
  `backend/packages/api/src/interaction-tokens.ts`, per the session's explicit instruction to reuse that
  token-binding pattern. It deliberately has no `outcome` field; adding one before Phase 2 would
  have fabricated a decision type this phase is not scoped to define.
- Report ordering uses a `ReportSequenceSchema` (`gateSessionId` + monotonic `sequence` +
  `issuedAt`) plus a pure `isStaleSequence()` helper, so "reject a sequence no newer than one
  already applied for that session" (docs/THREAT_MODEL.md's "Continuous decision revisions") is
  defined once and is independently unit-tested, not left as an unenforced field.
- `BrowserEvidenceSchema` and its sub-schemas were checked field-by-field against the "Allowed"
  column of `THREAT_MODEL.md`'s sanitized-telemetry table before being added; no field beyond
  that table's five allowed rows (route path, click category + `data-powerotp-id`, mouse
  directness, scroll smoothness, honeypot activations) exists in the type.
- **Test-infrastructure fix required to make the "type-level exclusion" test requirement real**:
  the pre-existing `backend/packages/contracts/tsconfig.json` excludes `src/**/*.test.ts` (needed so
  `npm run build` doesn't emit test files into `dist`), and both `lint` and `typecheck` reused
  that same build config — meaning **no test file in this package (including the pre-existing
  `index.test.ts`) was ever actually type-checked by `npm run typecheck`/`npm run lint`
  before this phase**, since `tsx` (used to *run* tests) only transpiles and never type-checks.
  This made the required `@ts-expect-error` type-level prohibited-field tests unenforceable as
  written. Fixed by adding `backend/packages/contracts/tsconfig.typecheck.json` (extends the same base
  config, includes test files, `noEmit: true`, does not affect `dist` output) and pointing only
  `lint`/`typecheck` (not `build`) at it. Verified the fix has teeth: temporarily removing a
  `// @ts-expect-error` comment during development caused `npm run typecheck -w
  @powerotp/contracts` to fail with a real `TS2353` excess-property error, then restored it
  and confirmed a clean pass — see Tests and results below.
- Also changed the contracts package's `test` script from a single hardcoded file
  (`node --import tsx --test src/index.test.ts`) to a glob
  (`node --import tsx --test "src/**/*.test.ts"`), matching the pattern `libraries/sdk-js`
  already uses, so `botblocker.test.ts` runs alongside `index.test.ts` without either file
  growing indefinitely (keeps both under the file-size guideline).

**Exact files changed:**

- `backend/packages/contracts/src/botblocker.ts` (new) — all Phase 1 contracts.
- `backend/packages/contracts/src/botblocker.test.ts` (new) — boundary tests (49/50/2000/2001 ms),
  prohibited-field tests (type-level `@ts-expect-error` plus runtime `safeParse` rejection),
  behavior-report/discriminated-union tests, `isStaleSequence` tests, decision-envelope tests,
  request-context tests, and unavailable/error-response tests.
- `backend/packages/contracts/src/index.ts` (added `export * from "./botblocker.js";`).
- `backend/packages/contracts/tsconfig.typecheck.json` (new) — see test-infrastructure fix above.
- `backend/packages/contracts/package.json` (`lint`/`typecheck` scripts point at the new typecheck
  config; `test` script now globs `src/**/*.test.ts` instead of naming one file).

**Migrations.** None.

**Configuration and environment variables.** None introduced, as expected for a contracts-only
phase — no new environment variable exists for BotBlocker yet.

**Tests and results.**

- `npm run test -w @powerotp/contracts`: 43 tests / 14 suites, 0 failures (up from the
  pre-existing suite's own count; all pre-existing tests still pass unchanged).
- `npm run typecheck -w @powerotp/contracts` and `npm run lint -w @powerotp/contracts`: clean,
  now actually type-checking both test files (see the test-infrastructure fix above).
- `npm run build -w @powerotp/contracts`: clean; confirmed `dist/` contains only
  `botblocker.js`/`botblocker.d.ts` (plus the pre-existing files) and no `.test.*` artifacts.
- `npm run verify` (full monorepo: build + lint + test across every workspace): exit code 0,
  zero failures anywhere, run in full before declaring this phase complete.

**Manual production/deployment steps.** None. This phase shipped a library-only export with no
consumer; there is nothing to deploy.

**New findings / changes to the plan.**

- The test-type-checking gap described above (test files silently never type-checked in this
  package) pre-dates this phase and was not limited to BotBlocker code — `index.test.ts` had the
  same exposure. It is now fixed for `backend/packages/contracts` specifically. Other packages
  (`libraries/sdk-js`, `backend/packages/api`, etc.) were not audited or changed this phase; if a future
  phase relies on `@ts-expect-error`-style type-level tests elsewhere, check whether that
  package's `lint`/`typecheck` scripts actually include its test files first.

**Unresolved risks / open questions carried into later phases.**

- The real `allow | otp` decision union, challenge/policy/clearance/Passport/PaidTokenPass
  contracts, and rejection of unsigned clearance or browser-supplied scores are Phase 2's job —
  none of that exists yet; `DecisionRevisionEnvelopeSchema` is an empty envelope with no outcome
  field by design.
- No cryptographic primitive exists yet (Phase 3) — `DecisionRevisionEnvelopeSchema`'s
  `nonce`/`audience`/`expiresAt` fields are unsigned placeholders for what Phase 3's Ed25519
  signing will eventually wrap.
- `isStaleSequence()` is pure logic with no storage backing it yet — an actual "last applied
  sequence per gate session" store arrives with Phase 6's persistence and Phase 20's continuous
  reassessment; Phase 1 only guarantees the *comparison* is defined once and correctly, not that
  anything durable enforces it yet.
- Business/legal open questions in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` section 10 remain open
  and untouched, as instructed.
- The SOC 2/ISO 27001 control matrix was not updated this phase: no row's actual implementation
  status changed (A.8.24 cryptography correctly stays "Planned" since no signing exists yet; the
  secure-development-lifecycle rows already reflected the process itself, not this specific
  artifact).

**Phase 2 prerequisites.** None outstanding — Phase 2 (Decision, challenge, and proof contracts)
may start from a fresh session once this entry is recorded. Phase 2 should extend
`backend/packages/contracts/src/botblocker.ts` (or add a sibling file re-exported from `index.ts`) with
the `allow | otp` union, challenge lifecycle, policy, clearance, Passport assertion,
PaidTokenPass assertion, risk-event batch, and explicit unavailable responses, reusing
`BotBlockerProtocolVersionSchema`, `ReportSequenceSchema`/`isStaleSequence`,
`DecisionRevisionEnvelopeSchema`, and the `BotBlockerUnavailableResponseSchema`/
`BotBlockerErrorResponseSchema` shapes already defined here rather than duplicating them.

### Phase 2 — Decision, challenge, and proof contracts (2026-08-12)

**Outcome.** Completed the BotBlocker contract surface named in
`docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`'s Phase 2 scope: the real `allow | otp`
decision outcome (now filling `DecisionRevisionEnvelopeSchema`'s previously absent `outcome`
field), BotBlocker challenge lifecycle contracts, signed-policy payload contracts, an unsigned
site-clearance contract, and Passport-assertion/PaidTokenPass-assertion/risk-event-batch proof
shapes — every one of them reusing Phase 1's `BotBlockerProtocolVersionSchema`, `SiteIdSchema`,
`ReportSequenceSchema`, `HoneypotActivationSchema`, `DecisionRevisionEnvelopeSchema`, and the
`BotBlockerUnavailableResponseSchema`/`BotBlockerErrorResponseSchema` shapes rather than
duplicating them. No route, middleware, signing, scoring, or persistence was added — this phase
is contracts only, exactly as scoped.

**Architecture decisions/clarifications recorded this phase:**

- `DecisionRevisionEnvelopeSchema` (defined in Phase 1, in `botblocker.ts`) now requires an
  `outcome: BotBlockerDecisionOutcomeSchema` field (`"allow" | "otp"` only, `.strict()` object)
  — the two prior Phase 1 tests asserting "no outcome field" and "rejects a fabricated outcome
  field" were rewritten in `botblocker.test.ts` to assert the opposite (outcome is now required
  and validated), since keeping the old assertions would have contradicted this phase's explicit
  scope. `BotBlockerDecisionOutcomeSchema` was added directly in `botblocker.ts` next to the
  envelope it fills, not a new sibling file, since it is a single three-line enum tightly coupled
  to that existing schema.
- Four new sibling files (not edits to `botblocker.ts`, to keep that file from growing past
  Phase 1's already-large size) hold the rest of Phase 2's scope, each re-exported from
  `index.ts`:
  - `botblocker-challenge.ts` — BotBlocker's own bot-detection-interaction challenge lifecycle
    (`pending → presented → {completed, expired, canceled}`), explicitly a different concept
    from the OTP `ChallengeSchema` in `verification.ts` (a phone-verification "select what you
    heard" challenge). Only the genuinely shared UX conventions — minimum 2 options, a
    single-answer challenge must require exactly one selection — are mirrored, not imported,
    so the two concepts can never be silently conflated by sharing a type. Added
    `isValidBotBlockerChallengeTransition()` and `isBotBlockerChallengeExpired()` as pure
    functions mirroring Phase 1's `isStaleSequence()` pattern (logic defined and unit-tested
    once, no storage backing it until Phase 6/8).
  - `botblocker-policy.ts` — the policy fields listed in
    `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Signed Policy Client" section, as an unsigned payload
    shape: `riskWeights` is an opaque `{ modelVersion, payload: Record<string, unknown> }` blob
    (real weights are Phase 17), `verificationKeys` is an opaque `{ keyId }[]` reference list
    with no key material field at all (signing is Phase 3), and `protocolVersion` reuses the
    Phase 1 literal schema so "protocol compatibility" is enforced by the existing versioned
    identifier rather than a new parallel field. Added `isPolicyVersionRegression()`, mirroring
    `isStaleSequence()` exactly (equal-or-older is a rejectable regression), to satisfy the
    session's required "rollback/version-regression rejection test."
  - `botblocker-clearance.ts` — the unsigned site-clearance shape referenced in
    `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Tokens and cookies" section
    (`powerotp_access`)/`docs/THREAT_MODEL.md`'s "Forged clearance and signed policy". Modeled
    as `SiteClearanceSchema = z.discriminatedUnion("signatureStatus", [UnsignedSiteClearanceSchema])`
    with exactly one member today (`signatureStatus: "unsigned"`) specifically so "this clearance
    has no signature" is a fact the schema expresses structurally — a `signatureStatus: "signed"`
    value is rejected today because no such union member exists yet, not merely because a field
    happens to be absent. Phase 3 adds a `SignedSiteClearanceSchema` member alongside this one;
    nothing before Phase 3 can be parsed as signed through this contract.
  - `botblocker-proofs.ts` — Passport-assertion, PaidTokenPass-assertion, and risk-event-batch
    proof shapes, grouped in one file because all three are "what a caller presents/submits"
    contracts with the same reject-by-construction property: every object is `.strict()`, so a
    self-declared `verified`, `passed`, `score`, or `decision` field is rejected at parse time.
    `RiskEventSchema` reuses Phase 1's `HoneypotActivationSchema` for its one honeypot-carrying
    event kind rather than duplicating that shape.
- Extended `botblocker.ts`'s existing `botBlockerErrorCodes` enum (rather than creating a
  parallel error-code type) with two new codes this phase's rejections need and the existing
  seven don't cover: `policy_version_regression` and `invalid_challenge_transition`.
- Followed the exact reject-by-construction test pattern Phase 1 established for
  `BrowserEvidenceSchema` (type-level `@ts-expect-error` assignment plus a runtime `safeParse`
  rejection) for every new prohibited-field case this phase required: a decision envelope with a
  browser-computed `score`, a challenge completion with a self-declared `passed`, an unsigned
  clearance with a forged `signature`/`keyId`, a policy verification-key entry with embedded key
  material, a policy with a forged `signature` field, a Passport assertion with a self-declared
  `verified` claim or a cross-site global identifier, a PaidTokenPass assertion with a
  self-declared `remainingQuota`, and a risk event with a self-declared `score` or `decision`.

**Exact files changed:**

- `backend/packages/contracts/src/botblocker.ts` (edited) — added `botBlockerDecisionOutcomes`/
  `BotBlockerDecisionOutcomeSchema`, added `outcome` to `DecisionRevisionEnvelopeSchema`, added
  `policy_version_regression`/`invalid_challenge_transition` to `botBlockerErrorCodes`, updated
  the file's top-of-file and envelope doc comments to describe Phase 2's changes instead of
  deferring them.
- `backend/packages/contracts/src/botblocker-challenge.ts` (new) — challenge lifecycle contracts.
- `backend/packages/contracts/src/botblocker-policy.ts` (new) — signed-policy payload contracts.
- `backend/packages/contracts/src/botblocker-clearance.ts` (new) — unsigned site-clearance contract.
- `backend/packages/contracts/src/botblocker-proofs.ts` (new) — Passport/PaidTokenPass assertion and
  risk-event-batch contracts.
- `backend/packages/contracts/src/botblocker.test.ts` (edited) — replaced the two Phase 1 envelope
  tests that asserted "no outcome field" with outcome-union boundary tests (accepts `allow`/
  `otp`, rejects five different fabricated third values including an empty string) and envelope
  tests (accepts/rejects with and without `outcome`, rejects a browser-supplied `score`).
- `backend/packages/contracts/src/botblocker-challenge.test.ts` (new).
- `backend/packages/contracts/src/botblocker-policy.test.ts` (new).
- `backend/packages/contracts/src/botblocker-clearance.test.ts` (new).
- `backend/packages/contracts/src/botblocker-proofs.test.ts` (new).
- `backend/packages/contracts/src/index.ts` (edited) — added the four new sibling-file exports.

**Migrations.** None.

**Configuration and environment variables.** None introduced, as expected for a contracts-only
phase — no new environment variable exists for BotBlocker yet.

**Tests and results.**

- `npm run test -w @powerotp/contracts`: 111 tests / 29 suites, 0 failures (up from Phase 1's 43
  tests / 14 suites; every pre-existing test still passes unchanged except the two intentionally
  rewritten envelope tests described above).
- `npm run typecheck -w @powerotp/contracts` and `npm run lint -w @powerotp/contracts`: clean —
  both point at `tsconfig.typecheck.json` (Phase 1's fix), so every new `@ts-expect-error`
  assertion in the five test files this phase touched was confirmed to correspond to a real
  compile-time error, not merely an unused/unenforced directive. (One authoring mistake was
  caught this way during development: an inline array-literal `@ts-expect-error` in
  `botblocker-policy.test.ts` didn't trigger TypeScript's excess-property check because the
  literal wasn't directly assigned to an explicitly typed variable; fixed by assigning the
  forged object to an explicitly `PolicyKeyReference`-typed `const` first, matching the pattern
  every other reject-by-construction test in this codebase already uses.)
- `npm run build -w @powerotp/contracts`: clean; confirmed `dist/` contains
  `botblocker-challenge.js`/`.d.ts`, `botblocker-clearance.js`/`.d.ts`,
  `botblocker-policy.js`/`.d.ts`, `botblocker-proofs.js`/`.d.ts`, and the updated
  `botblocker.js`/`.d.ts` — no `.test.*` artifacts.
- `npm run verify` (full monorepo: build + lint + test across every workspace, including
  `frontend`'s Next.js production build and `backend/packages/api`'s test suite): exit code 0, zero failures
  in any workspace, run in full before declaring this phase complete.

**Manual production/deployment steps.** None. This phase shipped a library-only export with no
consumer; there is nothing to deploy.

**New findings / changes to the plan.**

- No product/architecture assumption was invalidated this phase; every contract shape traces
  directly to an existing field list in `POWEROTP_BOTBLOCKER_PLAN.md`, `THREAT_MODEL.md`, or
  Phase 1's own contracts, so neither `POWEROTP_BOTBLOCKER_PLAN.md` nor `THREAT_MODEL.md` needed
  an update this phase.
- The SOC 2/ISO 27001 control matrix was not updated this phase: no row's actual implementation
  status changed. A.8.5/A.8.24 (secure authentication / use of cryptography) correctly remain
  "Planned"/"Partially implemented" since this phase deliberately shipped only unsigned contract
  shapes — Ed25519 signing itself is still Phase 3, unimplemented.

**Unresolved risks / open questions carried into later phases.**

- No Ed25519 signing implementation exists yet (Phase 3) — `SiteClearanceSchema` has exactly one
  discriminated-union member (`"unsigned"`) and `BotBlockerPolicySchema` carries no `signature`
  field; Phase 3 must add the signed variants/fields as new schema members alongside these,
  never by mutating the unsigned shapes in place, so existing unsigned-shape tests keep meaning
  what they say.
- `isValidBotBlockerChallengeTransition()`, `isBotBlockerChallengeExpired()`, and
  `isPolicyVersionRegression()` are pure logic with no storage backing them yet — persistence
  for challenges (`botblockerChallenges`) and policy releases (`policyReleases`) arrives in
  Phase 6/7, same caveat as Phase 1's `isStaleSequence()`.
- No HTTP route exists yet for any Phase 2 contract (`/v1/botblocker/challenges`,
  `/v1/botblocker/policy/{siteId}`, `/v1/botblocker/passports/*`, `/v1/botblocker/paid-passes/*`,
  `/v1/botblocker/risk-events`) — that is Phase 8. Every one of those routes must return
  `BotBlockerUnavailableResponseSchema` (reused, not duplicated) until its real backing phase
  ships.
- Business/legal open questions in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` section 10 remain open
  and untouched, as instructed.
- `isStaleSequence()`'s Phase 1 storage gap remains unresolved (still Phase 6/20), unaffected by
  this phase.

**Phase 3 prerequisites.** None outstanding — Phase 3 (Ed25519 signed-artifact primitive) may
start from a fresh session once this entry is recorded. Phase 3 should add the canonical
sign/verify helpers and then extend `SiteClearanceSchema` with a new `SignedSiteClearanceSchema`
discriminated-union member (`signatureStatus: "signed"`) and add a genuine `signature`/`keyId`
field set to `BotBlockerPolicySchema`'s payload envelope, reusing this phase's
`UnsignedSiteClearanceSchema`/`BotBlockerPolicySchema`/`PolicyKeyReferenceSchema` shapes as the
payload the new signature covers rather than duplicating them.

## 2026-08-13 — Phase 3: Ed25519 signed-artifact primitive

**Outcome.** Complete. BotBlocker now has a separate, real Ed25519 trust domain with
domain-separated canonical signing bytes, strict signed-clearance and signed-policy-release
contracts, and shared Node 22 sign/verify helpers. No OTP HMAC secret or helper is imported or
reused. This remains a library primitive only: no route, middleware, production key, rotation,
or replay store exists yet.

Before Phase 3, the live rapid-signup flow was corrected because its required website field was
blocking users who do not own a website. The modal's generic failure text also blamed every API
failure on HTTPS validation, so a valid URL could appear to be the cause when the actual failure
was rate limiting, credentials, email delivery, or another server error. Signup now accepts only
email/password, creates a neutral `My Project` with `allowedOrigins: []`, maps known API errors
to accurate messages, and lets customers add/replace/clear optional HTTPS origins on each
dashboard Project card later. `HttpsUrlSchema` also rejects malformed values without allowing a
`new URL()` exception to escape schema parsing.

**Implemented contracts and behavior.**

- `botblocker-signing.ts` defines the opaque signing-key ID, exact unpadded base64url Ed25519
  signature, artifact type, and signature-metadata schemas. Its browser-safe canonicalizer
  recursively sorts object keys, retains array order, and rejects non-JSON values, non-finite
  numbers, and non-plain objects.
- `SignedSiteClearanceSchema` is the second `SiteClearanceSchema` discriminated-union member.
  The Phase 2 unsigned shape remains strict and cannot carry a key ID or signature. The signed
  member covers the same audience/site/gate-session/nonce/issued/expiry claims plus required
  `keyId` and `signature`.
- `SignedBotBlockerPolicyReleaseSchema` is a strict envelope around the unchanged
  `BotBlockerPolicySchema`. The envelope adds audience, nonce, issuance, key ID, and signature;
  the signed payload retains the policy's authoritative site and expiry.
- New workspace `@powerotp/botblocker-signing` owns the Node-only `node:crypto` implementation,
  keeping it out of the browser-consumed contracts barrel. Canonical bytes include the
  `POWEROTP_BOTBLOCKER_ED25519_V1` domain, artifact type, key ID, audience, site, optional
  session, nonce, issued/expiry times, and payload.
- Verification requires an expected audience/site and, for clearance, expected gate session;
  it can also require an expected nonce. It rejects malformed/forged signatures, untrusted or
  mismatched keys, audience/site/session/nonce mismatch, expiry at the exact boundary, and any
  future issuance. There is deliberately no hidden clock-skew allowance; Phase 4 owns explicit
  skew policy.

**Exact files changed for the signup correction:**

- `backend/packages/contracts/src/auth.ts`
- `backend/packages/contracts/src/projects.ts`
- `backend/packages/contracts/src/index.test.ts`
- `frontend/app/signup-modal.tsx`
- `backend/apps/server/app/v1/auth/signup/route.ts`
- `frontend/app/dashboard/project-card.tsx`
- `docs/AS_BUILT.md`

**Exact files added/changed for Phase 3:**

- `backend/packages/contracts/src/botblocker-signing.ts` (new)
- `backend/packages/contracts/src/botblocker-signing.test.ts` (new)
- `backend/packages/contracts/src/botblocker-clearance.ts`
- `backend/packages/contracts/src/botblocker-clearance.test.ts`
- `backend/packages/contracts/src/botblocker-policy.ts`
- `backend/packages/contracts/src/botblocker-policy.test.ts`
- `backend/packages/contracts/src/index.ts`
- `backend/packages/botblocker-signing/package.json` (new)
- `backend/packages/botblocker-signing/tsconfig.json` (new)
- `backend/packages/botblocker-signing/src/index.ts` (new)
- `backend/packages/botblocker-signing/src/index.test.ts` (new)
- `package.json`
- `package-lock.json`
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`

**Migrations.** None.

**Configuration and environment variables.** None introduced. Sign/verify functions take key
material explicitly. Tests generate ephemeral Ed25519 keypairs in memory; no key is written to
disk, an environment file, documentation, or chat. Phase 4 must name and validate independent
BotBlocker active/previous key configuration without reusing any OTP secret.

**Tests and results.**

- `npm run typecheck -w @powerotp/contracts`: clean.
- `npm run test -w @powerotp/contracts`: 119 tests / 32 suites, 0 failures.
- `npm run build -w @powerotp/contracts`: clean.
- `npm run typecheck -w @powerotp/botblocker-signing`: clean.
- `npm run test -w @powerotp/botblocker-signing`: 7 tests / 2 suites, 0 failures. Covered valid
  clearance/policy round trips, forgery, malformed signatures, audience/site/session mismatch,
  exact expiry, future issuance, deterministic canonical signatures, wrong public key, unknown
  key ID, and policy-payload tampering.
- `npm run build -w @powerotp/botblocker-signing`: clean.
- `npm run verify`: exit code 0; full monorepo build, lint/typecheck, and tests passed, including
  the Next.js production build.

**Manual production/deployment steps.** None. No production configuration, key generation,
deployment, commit, or push was performed.

**Findings and control evidence.**

- A dedicated server-safe workspace is required because `@powerotp/contracts` is imported by
  client components; exporting `node:crypto` from its root barrel would risk a browser bundle
  boundary violation.
- ISO 27001 A.8.5 remains partially implemented with concrete signed-clearance evidence.
  A.8.24 moves from Planned to Partially implemented because cryptographic code and negative
  tests now exist, while production key lifecycle controls do not.
- `npm audit` reports one existing high-severity transitive `nanoid@3.3.17` advisory through
  Next.js's bundled PostCSS dependency. It is unrelated to Phase 3 and was not auto-fixed or
  widened into an unrequested dependency upgrade.

**Unresolved risks / Phase 4 prerequisites.**

- Add active/previous key overlap, retirement and revocation behavior, explicit clock-skew
  bounds, and Valkey-backed atomic one-time nonce consumption.
- Define production environment-variable names and validation for independent BotBlocker key
  material, without creating or documenting real values.
- Keep all HTTP routes, persistence beyond nonce replay, middleware, risk scoring, Passport,
  PaidTokenPass, and customer wrappers in their assigned later phases.

## 2026-08-13 — Phase 4: Key rotation and replay controls

**Outcome.** Complete. The server-only `@powerotp/botblocker-signing` workspace now signs
through an explicit active key, verifies active and time-bounded previous public keys, retires
the previous key at the exact overlap deadline, and lets revocation override overlap
immediately. Artifact verification has a validated `0`–`300000` ms clock-skew option while
preserving Phase 3's zero-implicit-skew default. A production-compatible Valkey adapter consumes
trusted nonces atomically with one `SET NX PX` operation and fails closed on storage errors.
The API validates independent BotBlocker key configuration at startup but remains deliberately
unconfigured and inactive when no active key is supplied. No route, policy publisher,
middleware, production key, or deployment was added.

The product plan was also amended, at the user's request, for a later PowerOTP-hosted
CleanDataPage feature. That documentation is planned behavior only: no CleanDataPage contract,
storage, route, token, dashboard control, payment exchange, ad/revenue logic, or customer
content exists yet. Its implementation is split into future Phases 24A–24C so none of it was
implemented early in Phase 4.

**Implemented behavior and security decisions.**

- `BotBlockerKeyRing` keeps the active private signing key separate from the public-only
  verification set. Configuration derives the active public key from its private key; the
  previous key accepts public SPKI material only.
- The previous key verifies strictly before `verifyUntil`; equality means retired. Revoked key
  IDs are rejected before active/previous lookup, so emergency revocation overrides an overlap
  window. Startup rejects an active key listed as revoked and rejects equal active/previous IDs.
- Active private material must parse as Ed25519 PKCS#8 DER and previous public material as
  Ed25519 SPKI DER. Both environment encodings are canonical base64. Tests generate all key
  material ephemerally in memory.
- Artifact time validation accepts issuance through `now + clockSkewMs` and treats expiry at
  `now - clockSkewMs` as expired. Omitted skew remains exactly zero; invalid or excessive
  bounds reject verification.
- Replay keys hash artifact type, site, audience, optional session, and nonce under a versioned
  Valkey prefix, preventing raw nonce disclosure and cross-site/cross-artifact collisions.
  Storage TTL extends through the explicit skew-adjusted validity boundary.
- Replay consumption returns `replay_detected` when `SET NX` loses, `expired` before writing an
  already-invalid nonce, and `storage_unavailable` on a Valkey exception. The latter is a
  rejection, never a fail-open success.
- `backend/packages/api/src/botblocker-replay.ts` passes the existing authenticated ioredis client directly
  to the atomic consumer; TypeScript verifies the production client implements the required
  `SET key value PX ttl NX` interface. Test fakes exist only in test files.

**Exact files added/changed for Phase 4 implementation:**

- `backend/packages/botblocker-signing/src/key-ring.ts` (new)
- `backend/packages/botblocker-signing/src/key-ring.test.ts` (new)
- `backend/packages/botblocker-signing/src/replay.ts` (new)
- `backend/packages/botblocker-signing/src/replay.test.ts` (new)
- `backend/packages/botblocker-signing/src/index.ts`
- `backend/packages/botblocker-signing/src/index.test.ts`
- `backend/packages/api/src/botblocker-config.ts` (new)
- `backend/packages/api/src/botblocker-config.test.ts` (new)
- `backend/packages/api/src/botblocker-replay.ts` (new)
- `backend/packages/api/src/config.ts`
- `backend/packages/api/src/config.test.ts`
- `backend/packages/api/package.json`
- `package-lock.json`
- `infrastructure/app-platform/README.md`
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`

**Planning-only files changed for CleanDataPage:**

- `docs/POWEROTP_BOTBLOCKER_PLAN.md`
- `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`
- `docs/THREAT_MODEL.md`

**Migrations.** None. Valkey stores only bounded-TTL nonce markers and requires no durable
schema migration. MongoDB was not used or changed.

**Configuration names and formats (no values created):**

- `BOTBLOCKER_ED25519_ACTIVE_KEY_ID`: 1–128-character key ID.
- `BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64`: canonical base64 of an Ed25519 PKCS#8
  DER private key; server-only and required with the active key ID.
- `BOTBLOCKER_ED25519_PREVIOUS_KEY_ID`: 1–128-character previous key ID, distinct from active.
- `BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64`: canonical base64 of the previous
  Ed25519 public key in SPKI DER; no previous private key is accepted.
- `BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS`: positive Unix timestamp in milliseconds; all
  three previous-key fields are required together.
- `BOTBLOCKER_ED25519_REVOKED_KEY_IDS`: optional comma-separated key IDs without spaces.
- `BOTBLOCKER_CLOCK_SKEW_MS`: optional integer `0`–`300000`, default `0`.
- Existing `VALKEY_URL` supplies the authenticated `rediss://` client. No new replay-store
  credential was introduced.

These names are independent from `INTERACTION_TOKEN_SECRET`, `CONFIG_ENCRYPTION_KEY`,
`SESSION_HASH_SECRET`, `API_KEY_HASH_SECRET`, `PASSWORD_PEPPER`, `PII_ENCRYPTION_KEY`, and
every OTP HMAC/AES/password secret.

**Tests and results.**

- `npm run typecheck -w @powerotp/botblocker-signing`: passed.
- `npm run test -w @powerotp/botblocker-signing`: 18 tests / 6 suites, 0 failures. Coverage
  includes active/previous verification, exact overlap retirement, revocation override,
  canonical DER loading, public-only verifier exposure, invalid grouped configuration,
  zero/bounded skew boundaries, first-use/replay, 20-way concurrent consumption, scope
  separation, expiry, and fail-closed storage errors.
- `npm run build -w @powerotp/botblocker-signing`: passed.
- `npm run typecheck -w @powerotp/api`: passed, including structural compatibility with the
  real ioredis client.
- `npm run test -w @powerotp/api`: 162 tests / 47 suites, 0 failures.
- `npm run verify`: exit code 0. Full monorepo build, lint/typecheck, and tests passed,
  including the Next.js production build; contracts remained at 119 tests / 32 suites with
  0 failures.
- `git diff --check`: clean.

**Manual production/deployment steps.** None performed. No key was generated for production,
no App Platform variable was changed, and nothing was deployed. Before a later activation
phase, an operator must generate an independent Ed25519 active key outside the repository,
store only the named values in DigitalOcean App Platform, publish/distribute only public
verification material, and rehearse rotation/revocation with a bounded overlap. Phase 4 does
not authorize configuring these values yet because no production BotBlocker consumer exists.

**Findings and control evidence.**

- Direct API tests/typechecks resolve workspace dependencies through built package exports, so
  `@powerotp/botblocker-signing` must be built first after its export surface changes. The root
  build already guarantees that order.
- ISO 27001 A.8.9 moves from not-applicable to partially implemented because validated
  BotBlocker service configuration now exists. A.8.24 remains partially implemented with
  concrete key-lifecycle/skew/replay evidence, and A.8.29 moves to partially implemented based
  on the Phase 1–4 negative/boundary/concurrency suites. No certification claim is made.
- Current dependency audit is clean at this HEAD; Phase 4 introduced no third-party package.

**Unresolved risks / Phase 5 prerequisites.**

- No route or middleware consumes these helpers yet. Later consumers must verify signatures
  before passing trusted claims to nonce consumption and must never treat
  `storage_unavailable` as success.
- Public-key distribution, signed policy publication, revocation-filter distribution, and
  production rotation operations remain later phases. The in-process revoked-ID set is not a
  substitute for those distribution mechanisms.
- Local site clearance is intentionally reusable during its short lifetime; one-time nonce
  consumption applies only where the later protocol marks an exchange/action as one-time.
  Phase 5 must not attach replay consumption blindly to every clearance read.
- Phase 5 may add only project BotBlocker configuration and timeout UI. It must reuse existing
  customer session/CSRF/project ownership patterns, stay disabled by default, and must not add
  policy routes, gate-session persistence, wrappers, CleanDataPage implementation, or later
  BotBlocker behavior.

## 2026-08-13 — Phase 5: Project configuration and timeout UI

**Outcome.** Complete. Each customer project now has one durable `botblockerSites`
configuration with a cryptographically random public site ID, an `enabled` preference that
defaults to `false`, and an integer decision timeout from 50 through 2,000 ms that defaults to
the recommended 200 ms. Authenticated customers can read and update only their own project's
configuration through `GET/PATCH /v1/projects/{projectId}/botblocker`; PATCH requires the
existing session CSRF token and writes an audit event. Every dashboard Project card now has a
collapsed BotBlocker panel for these two settings.

This phase does not activate customer traffic. The `enabled` value is stored configuration
only: no policy service, gate route, middleware, wrapper, sensor, risk engine, or deployment
consumes it. The UI states this explicitly. No site credential, private signing key, or
server-only configuration is stored in or returned by the customer-visible contract.

**Exact files added/changed:**

- `backend/packages/contracts/src/botblocker-site.ts` (new)
- `backend/packages/contracts/src/botblocker-site.test.ts` (new)
- `backend/packages/contracts/src/index.ts`
- `backend/packages/api/src/botblocker-site-persistence.ts` (new)
- `backend/packages/api/src/botblocker-site-service.ts` (new)
- `backend/packages/api/src/botblocker-site-service.test.ts` (new)
- `backend/packages/api/src/persistence.ts`
- `backend/apps/server/app/v1/projects/[projectId]/botblocker/route.ts` (new)
- `backend/apps/server/lib/server-context.ts`
- `frontend/app/dashboard/botblocker-panel.tsx` (new)
- `frontend/app/dashboard/project-card.tsx`
- `frontend/app/dashboard.css`
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`

**Contracts and persistence.**

- `BotBlockerSiteConfigurationSchema` is strict and exposes only `siteId`, `projectId`,
  `enabled`, `decisionTimeoutMs`, and creation/update timestamps.
- `UpdateBotBlockerSiteConfigurationSchema` is strict, requires at least one recognized field,
  and reuses Phase 1's inclusive integer `DecisionTimeoutMsSchema`.
- `DEFAULT_BOTBLOCKER_SITE_CONFIGURATION` defines the one shared disabled/200 ms default.
- MongoDB collection `botblockerSites` stores `_id`, `projectId`, `customerId`, `enabled`,
  `decisionTimeoutMs`, `createdAt`, and `updatedAt`. A unique `projectId` index enforces one
  site configuration per project; a `customerId`/`updatedAt` index supports customer-scoped
  management.
- First authorized read lazily and durably creates the default row, covering projects that
  predate Phase 5 without a one-off data migration. Both reads and mutations independently
  verify the session customer's ownership against the `projects` collection before touching
  `botblockerSites`. Cross-tenant misses return the existing non-enumerating
  `project_not_found` response.
- PATCH records `botblocker_site.updated` in the existing `auditEvents` collection with only
  the changed non-secret settings and optional request IP.

**Configuration names.** None introduced. Phase 4's optional
`BOTBLOCKER_ED25519_*`/`BOTBLOCKER_CLOCK_SKEW_MS` names and existing platform MongoDB, session,
CSRF, audit, and Valkey configuration remain unchanged. No `.env` file or DigitalOcean value
was read, printed, or modified.

**Tests and results.**

- `npm run typecheck -w @powerotp/contracts`: passed.
- `npm run test -w @powerotp/contracts`: 124 tests / 33 suites, 0 failures. The five new tests
  cover disabled/200 ms defaults, inclusive 50/2,000 ms boundaries, invalid integer/range and
  empty/unknown updates, and compile-time/runtime exclusion of credentials and signing keys.
- `npm run build -w @powerotp/contracts`: passed.
- `npm run typecheck -w @powerotp/api`: passed.
- `npm run test -w @powerotp/api`: 167 tests / 48 suites, 0 failures. The five new service
  tests cover durable default creation, idempotent reads, audited updates, and cross-tenant
  read/mutation isolation.
- Backend API build and frontend typecheck passed (current commands:
  `npm --prefix backend run build -w @powerotp/api` and `npm --prefix frontend run typecheck`).
- `npm run verify`: exit code 0. The full monorepo build, lint/typecheck, and test sequence
  passed, including the Next.js production build.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: clean.

**Manual/migration/deployment steps.** No one-off MongoDB migration is needed. On a future
normal application startup, `ensureIndexes()` creates the two `botblockerSites` indexes and
existing projects receive their disabled default row on first authorized GET/PATCH. Nothing
was deployed and no production configuration was changed in this phase. Deployment remains
insufficient to activate BotBlocker because no customer-traffic consumer exists.

**Historical Phase 7 findings and unresolved risks (recorded before Phase 8).**

- The existing Next.js route layer already centralizes customer-session authentication, CSRF
  verification, correlation IDs, error mapping, and server context. Phase 5 reused those
  mechanisms rather than adding a parallel authentication path.
- A customer's stored `enabled: true` preference is not evidence of runtime readiness and must
  never be treated as activation by itself. A later activation phase must require real backing
  services, signed policy, site credential provisioning, and end-to-end readiness checks.
- Phase 5 intentionally creates no BotBlocker site credential. Future server-to-server
  authentication must use a new BotBlocker-specific credential lifecycle, never the existing
  OTP API key, callback secret, interaction-token secret, or Ed25519 private signing key.
- No browser-facing code receives secret material; however, bundle/response leakage must still
  be rechecked when credential provisioning and wrappers are implemented.
- No CleanDataPage contract, row, token, payment, ad, or revenue behavior was added; that work
  remains exclusively in Phases 24A–24C.

**Phase 6 prerequisites.** Phase 6 may define and index only the planned `gateSessions`,
`userIntelligence`, `riskEvents`, and `botblockerChallenges` persistence. It must decide and
encode approved variable TTL retention before collecting real data, model repeated IPs as
observations rather than unique identities, maintain project/customer scoping, and seed no fake
development or production records. It must not add the Phase 7 policy HTTP service, Phase 8 API
surface, scoring, wrappers, OTP orchestration, Passport, PaidTokenPass, or CleanDataPage work.

## 2026-08-13 — Phase 6: Gate-session and intelligence persistence

**Outcome.** Complete. Added strict contracts and durable MongoDB definitions for
`gateSessions`, `userIntelligence`, `riskEvents`, and `botblockerChallenges`. A gate session is
one project-dashboard visit row; many gate sessions can reference one project-scoped
`userIntelligence` profile. Immutable behavior reports and sanitized risk signals are normalized
into `riskEvents` and retain both references, allowing a future expanded visit row without an
unbounded embedded MongoDB array. Challenge rows record lifecycle and optional authoritative OTP
references/results without implementing OTP orchestration.

BotBlocker remains inactive for customer traffic. This phase adds no route, sensor, matching
execution, score, threshold, policy service, OTP flow, fake data, or production record.

**Exact files added/changed:**

- `backend/packages/contracts/src/botblocker-persistence.ts` (new)
- `backend/packages/contracts/src/botblocker-persistence.test.ts` (new)
- `backend/packages/contracts/src/index.ts`
- `backend/packages/api/src/botblocker-intelligence-persistence.ts` (new)
- `backend/packages/api/src/botblocker-intelligence-persistence.test.ts` (new)
- `backend/packages/api/src/persistence.ts`
- `docs/PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`

**Contracts and durable entities.**

- Every record carries explicit `customerId`, `projectId`, and `siteId`; every relationship is
  explicit rather than inferred from an IP or fingerprint.
- `gateSessions` uses a server-generated opaque `bgs_*` ID and stores
  `userIntelligenceId`, server-derived fingerprint/keyed-IP lookup hashes, lifecycle state,
  optional latest `allow | otp`, `lastAppliedSequence`, start/last-observed/end timestamps, audit
  timestamps, and `retentionExpiresAt`.
- `userIntelligence` uses a server-generated opaque `bui_*` ID and stores a non-unique
  server-derived fingerprint hash, repeatable keyed-IP observations with first/last/count,
  latest sanitized evidence, gate-session/report counts, first/last-observed timestamps, audit
  timestamps, and `retentionExpiresAt`. It deliberately has no risk-score field; scoring is
  Phase 17.
- `riskEvents` uses a server-generated opaque `bre_*` ID and is a strict union of
  `behavior_report` (the existing first/recurring/partial report contract) and `risk_signal`
  (the existing sanitized risk-event contract). Every row binds
  `userIntelligenceId`, `gateSessionId`, report sequence, event index, occurrence/audit
  timestamps, and `retentionExpiresAt`. This is the durable history from which later phases may
  update intelligence aggregates.
- `botblockerChallenges` uses a server-generated opaque `bbc_*` ID and stores
  `userIntelligenceId`, `gateSessionId`, the existing BotBlocker challenge state, optional
  existing verification type/request linkage and success/failure result, lifecycle timestamps,
  audit timestamps, and `retentionExpiresAt`. A result is invalid without an authoritative OTP
  reference. No row is written and no success is fabricated in this phase.
- Strict schemas reject missing scope, mismatched session/report sequences, invalid retention
  boundaries, browser-supplied scores, raw page content, and fields prohibited by the sanitized
  telemetry contract.
- Raw IP addresses are not durable fields. Matching storage uses a future server-derived keyed
  hash, and the same value is expressly allowed on multiple intelligence/session records. No
  unique IP or fingerprint identity constraint exists.

**Indexes.**

- `gateSessions`: dashboard `{ customerId, projectId, siteId, startedAt }`; intelligence
  relationship `{ customerId, projectId, siteId, userIntelligenceId, lastObservedAt }`; TTL on
  `retentionExpiresAt`.
- `userIntelligence`: 30-day-match-supporting project/site/fingerprint/keyed-IP/
  `lastObservedAt` index; separate project/site/keyed-IP/`lastObservedAt` index; TTL on
  `retentionExpiresAt`. Both lookup indexes are intentionally non-unique.
- `riskEvents`: unique compound
  `{ customerId, projectId, siteId, gateSessionId, reportSequence, eventIndex }` for sequence
  idempotency; intelligence-history index
  `{ customerId, projectId, siteId, userIntelligenceId, occurredAt }`; TTL on
  `retentionExpiresAt`.
- `botblockerChallenges`: scoped gate-session/issuance index and TTL on
  `retentionExpiresAt`.
- MongoDB's built-in unique `_id` index protects each server-generated entity ID.
- `BotBlockerIntelligencePersistence` includes scope on every read and event-list query. Its
  sequence advancement is one atomic `findOneAndUpdate` requiring
  `lastAppliedSequence < candidate`, so equal/older or cross-project updates return no row.

**Approved retention and lookup periods.**

- All four categories retain records for 18 months, encoded consistently with the existing
  platform convention as 548 days.
- Gate-session retention refreshes from `lastObservedAt`.
- User-intelligence retention refreshes from `lastObservedAt`.
- Each risk-event row retains from `occurredAt`.
- Challenge retention refreshes from its latest lifecycle `updatedAt`; its operational
  `expiresAt` remains a separate challenge-validity boundary.
- Fingerprint/IP matching may search only the preceding 30 days. Phase 6 exports the exact
  30-day cutoff and creates supporting indexes, but does not implement matching.
- `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` was reconciled from its prior contradictory
  verified/suspected split to this approved uniform schedule and records pre-launch DPIA/LIA
  confirmation as required.

**Configuration names.** None introduced. No `.env` or DigitalOcean value was read, printed, or
changed. A later real-ingestion phase must define and validate the independent server-side keyed
derivation configuration before producing fingerprint/IP lookup hashes; Phase 6 does not invent
a secret name or permit unkeyed/raw-IP persistence.

**Tests and results.**

- `npm run build/typecheck/test -w @powerotp/contracts`: passed; 134 tests / 34 suites,
  0 failures. New tests cover strict scope, repeated-IP non-identity, prohibited fields,
  no caller-supplied score, report/session sequence binding, retention boundaries, sanitized
  event persistence, and authoritative challenge linkage.
- `npm run build/typecheck/test -w @powerotp/api`: passed; 174 tests / 49 suites,
  0 failures. New tests cover opaque IDs, exact 18-month retention, exact 30-day lookback,
  required TTL/lookup/relationship/idempotency indexes, absence of a unique IP constraint,
  atomic stale-sequence rejection, and cross-project isolation for all four entities.
- `npm run verify`: passed after removing only the generated `frontend/.next` directory and
  retrying the documented OneDrive `EPERM` failure. Full build/lint/test passed, including the
  Next.js production build.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: clean.

**Manual/migration/deployment steps.** No manual or remote MongoDB migration is required.
`ensureIndexes()` now invokes `ensureBotBlockerIntelligenceIndexes()` during normal API startup.
No collection is seeded. No production environment, key, database, or deployment was changed.

**Findings and unresolved risks.**

- A normalized `riskEvents` history is required to preserve every five-second/30-second/partial
  report without letting a long-running gate-session or intelligence document approach MongoDB's
  document-size limit.
- The persistence boundary is ready, but no writer exists. Phase 15 must derive keyed lookup
  hashes from trusted inputs, perform the 30-day match, create a new intelligence row on no
  match, atomically persist reports/events, and update aggregates. It must never accept a
  browser-supplied fingerprint hash or score.
- The 18-month retention policy and 30-day operational lookback are implemented decisions, but
  legal confirmation remains a Phase 31 launch prerequisite through the DPIA/LIA and privacy
  notice.
- Challenge verification references/results are storage fields only. Phase 19 must bind them to
  the existing authoritative verification state machine; a browser submission or `postMessage`
  can never populate success.
- No CleanDataPage contract, persistence, route, token, UI, payment, advertising, or revenue
  behavior was added.

**Phase 7 prerequisites.** No Phase 6 blocker remains for the signed policy service. Phase 7
must add immutable `policyReleases` and signed `GET /v1/botblocker/policy/{siteId}` behavior,
including ETag, compatibility, active/expiry windows, key set, last-known-good handling, and
rollback protection. It must not activate customer traffic, add RapidAuth/browser ingestion,
perform intelligence matching/scoring, orchestrate OTP, or begin CleanDataPage work.

## 2026-08-13 — Phase 7: Signed policy service

**Outcome.** Complete in code and intentionally inactive in production. Added immutable,
customer/project/site-scoped signed policy persistence, an internal publication service using
the existing BotBlocker Ed25519 trust domain, and public
`GET /v1/botblocker/policy/{siteId}` delivery. The route returns a verified active release and
bounded decision-timeout metadata, supports strong ETags and conditional `304` responses, and
returns typed `policy_unavailable` when no valid active release can be served. No production
key, release, customer activation, deployment, fake policy, score, dataset, or risk weight was
created.

**Exact files added/changed:**

- `backend/packages/contracts/src/botblocker-policy-persistence.ts` (new)
- `backend/packages/contracts/src/botblocker-policy-persistence.test.ts` (new)
- `backend/packages/contracts/src/index.ts`
- `backend/packages/api/src/botblocker-policy-persistence.ts` (new)
- `backend/packages/api/src/botblocker-policy-persistence.test.ts` (new)
- `backend/packages/api/src/botblocker-policy-service.ts` (new)
- `backend/packages/api/src/botblocker-policy-service.test.ts` (new)
- `backend/packages/api/src/botblocker-site-persistence.ts`
- `backend/packages/api/src/persistence.ts`
- `backend/apps/server/lib/botblocker-policy-http.ts` (new)
- `backend/apps/server/lib/http-etag.ts` (new)
- `backend/apps/server/lib/server-context.ts`
- `backend/apps/server/app/v1/botblocker/policy/[siteId]/route.ts` (new)
- `backend/apps/server/app/v1/botblocker/policy-route.test.ts` (new)
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`

**Contracts and persistence.**

- `PolicyReleaseRecordSchema` stores an opaque server-generated `bpr_*` ID, explicit
  `customerId`, `projectId`, and `siteId`, duplicated query metadata (`policyVersion`,
  `protocolVersion`, activation, expiry, and issuance timestamps), the existing strict
  `SignedBotBlockerPolicyRelease`, and `createdAt`.
- Contract refinements require every duplicated field, site binding, and release audience to
  match the signed authority. The response contract contains only the signed release and the
  existing bounded `decisionTimeoutMs`; the timeout remains a UX bound, not a security
  decision.
- `policyReleases` is append-only. There is no update or delete API. Its unique index is
  `{ customerId, projectId, siteId, policyVersion }`; active selection uses
  `{ customerId, projectId, siteId, policyVersion, activatesAt }`.
- `botblockerSites.latestPolicyVersion` and `latestPolicyReleaseId` form the mutable publication
  head. A MongoDB transaction conditionally advances that head only when the candidate version
  is greater, then inserts the immutable release in the same transaction. Equal, older, and
  cross-scope publications cannot insert a release.
- `ensureIndexes()` creates the two `policyReleases` indexes during normal application startup.
  No TTL applies: signed policy publications are immutable control records, not Phase 6
  behavioral-retention data.

**Signing, selection, and HTTP behavior.**

- Publication accepts an unsigned strict `BotBlockerPolicy`, never a caller signature. It
  resolves the authoritative site scope, requires a reference to the configured active
  verification key, creates a server nonce, signs with `signBotBlockerPolicyRelease()`,
  self-verifies with `verifyBotBlockerPolicyRelease()`, and then performs the transactional
  monotonic insert.
- The canonical policy audience is the public `siteId`. Fetch verification requires both that
  audience and the path/site binding, uses the configured active/previous verification-key
  ring and bounded skew, and re-verifies the stored signature before every response. Private
  key material is never persisted or returned.
- Protocol compatibility remains strict through the existing protocol-version literal.
  Sensor version and verification-key references remain inside the signed policy. The owning
  site's bounded decision timeout is delivered beside it.
- Selection chooses the greatest policy version whose activation time has arrived. A newer
  future release does not displace the current last-known-good-compatible release. Once a
  newer release has activated, an expired, malformed, incompatible, wrongly bound, revoked-key,
  or signature-invalid newest release yields `policy_unavailable`; the server never falls back
  to an older version. Future adapters may continue using their own still-valid cached
  last-known-good release.
- A disabled site returns `policy_unavailable`. `enabled: true` is also insufficient by itself:
  a configured key ring and valid active immutable release are required, and no production
  readiness or traffic activation is implied.
- Available responses use a strong SHA-256-derived ETag covering the signing key ID, signature,
  and decision timeout. Exact, weak, list, and wildcard `If-None-Match` validators produce
  bodyless `304` responses with ETag/cache headers. Unknown sites return typed `unknown_site`
  with `404`; absent/invalid active policy returns typed `policy_unavailable` with `503`.
  The existing route wrapper adds a correlation ID to every outcome.

**Configuration names.** No configuration field was added. The service consumes the existing
`BOTBLOCKER_ED25519_ACTIVE_KEY_ID`,
`BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64`,
`BOTBLOCKER_ED25519_PREVIOUS_KEY_ID`,
`BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64`,
`BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS`,
`BOTBLOCKER_ED25519_REVOKED_KEY_IDS`, and `BOTBLOCKER_CLOCK_SKEW_MS` fields. No value was read,
printed, written, or documented.

**Tests and results.**

- `@powerotp/contracts`: 138 tests / 35 suites, 0 failures. New tests cover strict scoped
  persistence, signed/query metadata agreement, audience/site binding, unknown-field rejection,
  and bounded timeout delivery.
- `@powerotp/api`: 187 tests / 51 suites, 0 failures. New tests cover immutable/indexed
  persistence, atomic equal/older rejection, cross-project selection, ephemeral-key signing,
  tampering, wrong audience/site, protocol mismatch, future activation, exact expiry, version
  regression, disabled sites, verification-key references, last-known-good-compatible
  selection, rollback refusal, unavailable behavior, and ETag changes.
- Backend Next.js route layer: 5 tests / 2 suites, 0 failures. New tests cover
  exact/weak/list/wildcard ETag matching and the `200`/`304`/`404`/`503` bodies and cache
  headers.
- `npm run verify`: passed, including all workspace build/lint/test steps and the Next.js
  production route build for `/v1/botblocker/policy/[siteId]`. No OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** No one-off or remote MongoDB migration is required.
Normal startup creates the indexes; publication uses the same transaction-capable MongoDB
deployment already required by platform balance operations. No collection was seeded. No
DigitalOcean setting, signing key, release, production database, customer configuration, or
deployment was changed. A future operator must configure a real BotBlocker key through the
existing secret-management path and publish through the authenticated Phase 8 administration
surface before any release can exist; those actions were deliberately not performed here.

**Findings and unresolved risks.**

- At the end of Phase 7, the service-level publication primitive was intentionally not an
  HTTP surface; Phase 8 subsequently added authenticated, authorized, audited admin
  release-management routes without accepting caller signatures or allowing in-place
  release edits.
- Unit tests exercise transactional outcomes with a MongoDB-compatible fake; no remote
  transaction or production database mutation was performed in this phase.
- Adapter-side schema/signature verification, ETag caching, last-known-good storage, and local
  rollback refusal remain wrapper work in Phases 11–13. The Phase 7 server behavior is designed
  so those adapters can fail safely without a server-side downgrade.
- No release exists. Absent keys/releases or a disabled site return `policy_unavailable`; this
  is absence of an operational recommendation, not a block decision. Future customer adapters
  must fail open for ordinary website access, and the customer's integration retains final
  control of its page. The new route does not make `enabled: true` production-ready.
- No RapidAuth, browser assessment, risk-event ingestion, intelligence matching/scoring,
  sensor, gate shell, middleware, OTP orchestration, Passport, PaidTokenPass, billing,
  metering, or CleanDataPage behavior was added.

**Historical Phase 8 handoff.** The following was the Phase 7 exit requirement, now
satisfied by the Phase 8 entry below: build the remaining central API surface and
authenticated policy release administration against these contracts and persistence
boundaries. The restriction against activating customer traffic, fabricating results,
exposing private signing material, reusing OTP secrets, or beginning later-phase
scoring/ingestion/CleanDataPage work remained in force.

## 2026-08-13 — Phase 8: Complete central API surface

**Outcome.** Complete in code and intentionally inactive in production. The planned primary
runtime origin is `https://verify.powerotp.com/v1/botblocker/*`; it is not deployed yet and
Phase 27 will deploy it on Cloudflare Workers. The Worker will retain at least 30 days of
current user-intelligence, denylisted-IP, and fingerprint data.
`https://api.powerotp.com` remains the authoritative full-history master-data service and
fallback rapid-check origin when the Worker is unavailable. Platform
operator routes use `/v1/control/botblocker/*` and retain the existing platform-admin session,
CSRF, IP-allowlisted login, rate-limit, correlation-ID, and error controls. No route name is
treated as authorization.

Phase 8 adds a separate hashed `potp_bb_*` site-credential lifecycle, strict runtime request
envelopes, bounded issuance, exact runtime/customer-origin and site binding, required mutation
idempotency, atomic Valkey nonce replay rejection, scoped rate limits, customer-owned visitor
reads, operator decision trace/health reads, and audited immutable policy publication. Every
service assigned to a later phase returns strict typed unavailable; no synthetic result is
returned or persisted.

**Exact files added/changed.**

- Contracts: `backend/packages/contracts/src/botblocker.ts`,
  `backend/packages/contracts/src/botblocker-api-runtime.ts`,
  `backend/packages/contracts/src/botblocker-api-runtime.test.ts`,
  `backend/packages/contracts/src/botblocker-api-control.ts`,
  `backend/packages/contracts/src/botblocker-api-control.test.ts`, and
  `backend/packages/contracts/src/index.ts`.
- API: `backend/packages/api/src/config.ts`, `backend/packages/api/src/config.test.ts`,
  `backend/packages/api/src/persistence.ts`, `backend/packages/api/src/botblocker-errors.ts`,
  `backend/packages/api/src/botblocker-site-credential-persistence.ts`,
  `backend/packages/api/src/botblocker-site-credential-persistence.test.ts`,
  `backend/packages/api/src/botblocker-site-credential-service.ts`,
  `backend/packages/api/src/botblocker-site-credential-service.test.ts`,
  `backend/packages/api/src/botblocker-runtime-security.ts`,
  `backend/packages/api/src/botblocker-runtime-security.test.ts`,
  `backend/packages/api/src/botblocker-intelligence-persistence.ts`,
  `backend/packages/api/src/botblocker-operations-service.ts`,
  `backend/packages/api/src/botblocker-operations-service.test.ts`,
  `backend/packages/api/src/botblocker-policy-persistence.ts`, and
  `backend/packages/api/src/botblocker-policy-control-service.ts`.
- Shared backend wiring: `backend/apps/server/lib/api-errors.ts`,
  `backend/apps/server/lib/botblocker-http.ts`,
  `backend/apps/server/lib/botblocker-responses.ts`,
  and `backend/apps/server/lib/server-context.ts`.
- Runtime/customer routes:
  `backend/apps/server/app/v1/botblocker/rapid-auth/route.ts`,
  `backend/apps/server/app/v1/botblocker/browser-assessment/route.ts`,
  `backend/apps/server/app/v1/botblocker/risk-events/route.ts`,
  `backend/apps/server/app/v1/botblocker/challenges/route.ts`,
  `backend/apps/server/app/v1/botblocker/challenges/[challengeId]/route.ts`,
  `backend/apps/server/app/v1/botblocker/challenges/[challengeId]/complete/route.ts`,
  `backend/apps/server/app/v1/botblocker/passports/register/route.ts`,
  `backend/apps/server/app/v1/botblocker/passports/assert/route.ts`,
  `backend/apps/server/app/v1/botblocker/paid-passes/assert/route.ts`,
  `backend/apps/server/app/v1/botblocker/agent/entitlements/route.ts`,
  `backend/apps/server/app/v1/projects/[projectId]/botblocker/visitors/route.ts`, and
  `backend/apps/server/app/v1/projects/[projectId]/botblocker/rotate-site-credential/route.ts`.
- Operator routes: `backend/apps/server/app/v1/control/botblocker/rapid-list/route.ts`,
  `backend/apps/server/app/v1/control/botblocker/decision-traces/[gateSessionId]/route.ts`,
  `backend/apps/server/app/v1/control/botblocker/health/route.ts`, and
  `backend/apps/server/app/v1/control/botblocker/policy-releases/route.ts`.
- Backend tests: `backend/apps/server/app/v1/botblocker/phase8-http.test.ts`.
- Documentation: `docs/POWEROTP_BOTBLOCKER_PLAN.md`,
  `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`, `docs/THREAT_MODEL.md`,
  `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`,
  `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`, and
  `infrastructure/app-platform/README.md`.

**Route inventory and boundaries.**

- Real: existing public `GET /v1/botblocker/policy/{siteId}`; customer
  `POST /v1/projects/{projectId}/botblocker/rotate-site-credential` and
  `GET /v1/projects/{projectId}/botblocker/visitors`; operator
  `GET /v1/control/botblocker/decision-traces/{gateSessionId}`,
  `GET /v1/control/botblocker/health`, and
  `GET/POST /v1/control/botblocker/policy-releases`.
- Strict unavailable: runtime rapid-auth, browser-assessment, risk-events, challenge
  create/read/complete, Passport register/assert, PaidTokenPass assert, agent entitlement, and
  operator rapid-list management. These handlers validate permanent authentication/security
  boundaries but do not invoke later-phase business logic.
- Customer routes require a customer session and non-enumerating project ownership; mutations
  also require CSRF. Operator routes require a platform-admin session; mutations also require
  CSRF and idempotency. Runtime mutations require the independent Bearer site credential,
  strict body schema, exact site/customer origin/runtime host, bounded issuance, idempotency,
  replay protection, and IP/site rate limits. Public `siteId` authorizes nothing.

**Persistence, indexes, and audit evidence.**

- `botblockerSiteCredentials` stores only scoped credential hashes, display prefix/last four,
  rotation-idempotency hash, creation, and revocation metadata. Unique indexes protect
  credential hashes, one active credential per site, and scoped rotation idempotency; a scope
  index supports lifecycle audit. Rotation revokes the prior active credential and inserts the
  replacement in one MongoDB transaction.
- Runtime idempotency and nonce claims use namespaced bounded-TTL Valkey keys. Storage failure
  returns dependency unavailable and never accepts the request.
- Credential rotation, policy publication, and operator decision-trace reads append to the
  existing `auditEvents` collection. Policy releases remain immutable; there is no update or
  delete route, and publication still signs only inside `BotBlockerPolicyService` with
  transactional version-regression protection.
- Visitor responses project only real project/site-scoped `userIntelligence` counts and
  timestamps. Decision traces project real stored event/challenge metadata without
  fingerprint/IP hashes, raw evidence, scores, or weights. Health is derived from actual
  dependency/configuration/release state and exposes no values.

**Configuration names (no values created).**

- `BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET`: optional independent secret for hashing site
  credentials; never reuse `API_KEY_HASH_SECRET` or any OTP/signing secret.
- `BOTBLOCKER_RUNTIME_ORIGIN`: optional exact HTTPS runtime origin; intended value is configured
  operationally only when the `verify.powerotp.com` Cloudflare Worker is deployed.
- Existing `BOTBLOCKER_ED25519_*`, `BOTBLOCKER_CLOCK_SKEW_MS`, `MONGODB_URI`, and `VALKEY_URL`
  remain unchanged. No `.env` or DigitalOcean value was read, printed, or modified.

**Tests and results.**

- `@powerotp/contracts`: build/typecheck passed; 151 tests / 39 suites, 0 failures.
  New suites cover strict runtime envelopes, scope/protocol agreement, prohibited caller
  authority, credential response metadata, visitor/control projections, and unsigned policy
  publication input.
- `@powerotp/botblocker-signing`: 18 tests / 6 suites, 0 failures.
- `@powerotp/api`: build/typecheck passed; 202 tests / 55 suites, 0 failures. New tests cover
  credential indexes/transactional replacement/idempotent rotation/authentication,
  independent hashing, tenant isolation, exact host/site/audience and timestamp binding,
  idempotency conflict, nonce replay, fail-closed Valkey errors, data-minimized visitors,
  audited traces, and real degraded health.
- Backend Next.js route layer: typecheck passed; 8 tests / 3 suites, 0 failures. New tests
  cover strict unavailable/authentication/replay/rate-limit response bodies.
- `npm run verify`: passed, including the Next.js production build and every new
  `/v1/botblocker/*`, `/v1/control/botblocker/*`, visitor, and credential-rotation route. No
  OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** Normal startup creates the new indexes; there is no
one-off migration and no seeded record. Before any future activation, an operator must
independently configure the credential hash secret/runtime origin, deploy and route the
`verify.powerotp.com` Cloudflare Worker, configure a real BotBlocker signing key, rotate a
customer site credential through its authenticated route, and publish an approved policy.
None of those actions is authorized or performed by this phase.

**Findings, unresolved risks, and Phase 9 prerequisites.**

- A site credential is server-only. Direct browser challenge/report calls still require the
  narrowly scoped adapter-issued runtime-token lifecycle assigned to the browser gate/wrapper
  phases; a browser must never receive `potp_bb_*`.
- The runtime routes deliberately remain unavailable until Phase 15/17/19/21–24 backing
  services exist. The real visitor/trace collections remain empty unless real later-phase
  ingestion occurs; no empty response is represented as evidence that ingestion is active.
- No remote MongoDB transaction test was performed. Production hostname/DNS, secret setup,
  rotation/revocation rehearsal, rate/load testing, penetration testing, and DPIA/LIA remain
  pre-launch work.
- Phase 9 may implement only the framework-neutral browser gate state machine and its
  authoritative client transitions. It must consume these stable unavailable/error contracts,
  keep ordinary access fail-open, never cancel a pending decision at the UX timeout, and must
  not start the Phase 10 sensor, Phase 15 ingestion, Phase 17 scoring, Phase 19 OTP binding,
  Passport/PaidTokenPass, deployment, or CleanDataPage work.

## 2026-08-13 — BotBlocker Phase 9: framework-neutral browser gate

**Outcome.** Added the private workspace package `@powerotp/gate-core` as the
framework-neutral browser state machine shared by future adapters. It implements exactly the
six documented client states: `checking`, `optimistic_allow`, `observing`, `otp_required`,
`verified`, and `unavailable`. It adds no sensor, framework wrapper, central decision service,
score, OTP completion service, Passport/PaidTokenPass behavior, or CleanDataPage behavior.

**Exact files.**

- Package/build: `package.json`, `package-lock.json`, `libraries/gate-core/package.json`,
  `libraries/gate-core/tsconfig.json`, and `libraries/gate-core/tsconfig.typecheck.json`.
- Production: `libraries/gate-core/src/index.ts`, `states.ts`, `decision.ts`, `controller.ts`,
  `polling.ts`, `post-message.ts`, `safe-return.ts`, and `page-lock.ts`.
- Tests: `libraries/gate-core/src/states.test.ts`, `decision.test.ts`, `controller.test.ts`,
  `polling.test.ts`, and `browser-boundary.test.ts`.
- Evidence: this file and
  `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`.

All production modules remain below 300 lines. The package depends at runtime only on
`@powerotp/contracts`; `happy-dom` is test-only.

**State transitions and effects.**

- `checking -> optimistic_allow` occurs when the validated 50–2,000 ms UX timer elapses.
  The controller retains `decisionPending: true`; it does not create or pass an abort signal,
  cancel the request, or detach its eventual result. Both timeout and request failure start
  fail-open observation so Phase 10 can still produce a later revision.
- A valid `allow` from `checking`, `optimistic_allow`, or `unavailable` enters `observing`.
  A valid `otp` from those states or `observing` enters `otp_required`, explicitly pauses
  observation, freezes the page, and starts authoritative polling.
- A later valid `otp` is accepted only when its sequence is newer for the bound gate session.
  A stale/equal decision, replayed nonce, malformed envelope, expired or excessively
  future-issued decision, wrong site, wrong session, wrong audience, or third outcome is
  rejected.
- While `otp_required`, a newer `allow`, timeout, network failure, and unavailable poll result
  cannot reopen the page. Only authoritative status `verified` bound to the exact site, gate
  session, and active challenge enters `verified`, stops polling, and unfreezes. A separate
  `verified -> observing` transition starts a fresh observation interval; no pre-OTP interval
  is resumed.
- `unavailable` is an open ordinary-access state. It records decision/network unavailability
  without fabricating an `allow`, score, proof, challenge result, or entitlement.

**Authority and browser boundary.**

- Gate-core receives raw decision material only through an injected verifier. The verifier
  must return `verified: true` only for an authentic signed server artifact; gate-core then
  independently applies the strict decision schema and site/session/audience/expiry/
  sequence/nonce checks. This does not invent the signed-decision wire artifact assigned to
  later scoring/revision phases.
- A trusted same-origin adapter may restore the last applied sequence/nonces and
  `otp_required` state before startup. Restored OTP starts frozen authoritative polling and
  does not issue a new fail-open decision request. Untrusted browser storage is not an
  authority source for this state.
- The public browser API contains no site credential, project API credential, signing key, or
  environment lookup. Static inspection found no `potp_bb_*`, credential/API-key, private-key,
  signing-key, or `process.env` reference in gate-core.
- The page lock mounts a credential-free HTTPS challenge iframe only on an explicitly
  approved origin. Its modal overlay makes existing and dynamically inserted customer
  elements inert and hidden from assistive technology, blocks Tab/Escape escape, suppresses
  body scrolling, focuses the challenge, and restores the exact prior
  accessibility/overflow/focus state on authoritative unfreeze.
- The strict iframe message guard binds source window, exact origin, challenge ID, and a
  three-field UX-only message. It can trigger an immediate server poll but cannot report or
  apply verification.
- The poller serializes authoritative checks, isolates stop/restart generations, persists
  through pending/network-unavailable results, and stops only on server-confirmed
  verification or explicit teardown.
- Safe returns accept only an approved relative same-origin path and preserve its query and
  fragment. Absolute, protocol-relative, credential-bearing, control-character, backslash,
  encoded slash/backslash, cross-origin, unapproved, and malformed values fall back to an
  approved path.

**Configuration names.** No environment variable or secret was added. Constructor inputs are
public/non-secret `siteId`, `gateSessionId`, customer `audience`, bounded
`decisionTimeoutMs`, bounded clock skew, an opaque decision request, an
authenticity-verifier port, optional trusted restored security state, and optional
clock/timer/effect callbacks. The approved challenge origin, poll interval, and
approved-return predicate are supplied by the future adapter. An active challenge ID must be
bound before authoritative verification can unlock the page. No production value is
configured in this phase.

**Tests and results.**

- `@powerotp/gate-core`: build/typecheck passed; 26 tests / 7 suites, 0 failures. Coverage
  includes all state edges, timeout bounds/non-cancellation, late and revised OTP, strict
  decision binding/replay/staleness, unsigned rejection, fail-open behavior, active-challenge
  persistence, site/session/challenge-bound authoritative verification, fresh observation
  restart, serialized polling,
  postMessage non-authority, DOM freeze/focus/cleanup, and safe-return redirects.
- `@powerotp/contracts`: 151 tests / 39 suites, 0 failures.
- `npm run verify`: passed, including all workspace builds, typecheck-based linting, tests,
  and the Next.js production build. No OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** None. No `.env` or DigitalOcean setting was read or
changed. No database/index migration, seed, runtime credential, signing key, policy release,
DNS record, deployment, or customer activation was created.

**Findings, unresolved risks, and Phase 10 prerequisites.**

- Signed decision response/revision contracts and delivery do not exist yet. Gate-core
  therefore exposes a fail-closed verifier port and cannot treat an unverified envelope as
  authoritative; later phases must bind that port to the independent BotBlocker trust domain.
- Browser-facing short-lived runtime-token issuance remains adapter/wrapper work. The gate
  neither accepts nor exposes the Phase 8 server-only `potp_bb_*` credential.
- The optimistic-load limitation remains inherent: a late OTP freezes future interaction but
  cannot retract customer content already delivered before the decision arrived.
- Phase 10 may consume only the explicit observation start/pause/fresh-resume effects and
  decision-revision entry point. It must implement the versioned continuous sensor, 5-second
  initial/30-second recurring/partial intervals, sanitized evidence, report ordering, and
  prohibited-field proof without changing the six-state authority rules.

## 2026-08-14 — BotBlocker Phase 10: continuous browser sensor

**Outcome.** Added a framework-neutral continuous browser sensor to
`@powerotp/gate-core`. It emits the existing strict first/recurring/partial behavior-report
contracts, integrates directly with Phase 9's observation effects and verifier-backed decision
entry point, and adds a narrowly versioned environment-evidence contract. No wrapper, HTTP
transport, runtime token, ingestion, matching, score, OTP orchestration, Passport,
PaidTokenPass, billing, deployment, or CleanDataPage behavior was added.

**Exact files.**

- Contracts: `backend/packages/contracts/src/botblocker.ts` and
  `backend/packages/contracts/src/botblocker.test.ts`.
- Sensor production: `libraries/gate-core/src/sensor.ts`,
  `libraries/gate-core/src/sensor-evidence.ts`, and
  `libraries/gate-core/src/index.ts`.
- Sensor tests: `libraries/gate-core/src/sensor.test.ts` and
  `libraries/gate-core/src/sensor-evidence.test.ts`.
- Evidence: this file, `docs/THREAT_MODEL.md`, and
  `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`.

All new production modules remain within the 200–300-line guideline. No dependency or package
manifest changed.

**Contracts and evidence minimization.**

- `BOTBLOCKER_CONTRACT_VERSION` is now `2026-08-14`; wire protocol remains version 1.
  `BrowserEnvironmentEvidenceSchema` is optional only so existing protocol-v1 report producers
  remain compatible, while this Phase 10 sensor always emits it.
- Environment evidence contains exactly `evidenceVersion: 1`, a validated immutable sensor
  version, and a bounded fixed-enum list of `webdriver`, `untrusted_pointer`,
  `untrusted_click`, and `untrusted_scroll`. Arbitrary indicators, raw user-agent strings,
  plugin/font inventories, browser-property scans, and raw event details are rejected.
- Routes are reduced to `location.pathname` and defensively strip query/fragment before the
  report is constructed. Clicks contain only a fixed element category and an explicit safe
  `data-powerotp-id`; honeypots use only an explicit safe
  `data-powerotp-honeypot-id`. Text, values, and selectors are never read into report state.
- Mouse processing retains only the current segment start/last point and running path length,
  then emits an average directness ratio and sample count. It never stores or emits a coordinate
  trail. Scroll processing retains only the previous aggregate sample and emits a normalized
  smoothness score plus high-speed count, never a scroll trail.
- Every sensor snapshot is parsed through `BrowserEvidenceSchema`, and every report is parsed
  through `BehaviorReportSchema` before the injected transport receives it. Compile-time and
  runtime contract tests reject raw fingerprint fields; sensor tests prove clicked text, form
  values, URL secrets, coordinate trails, scroll trails, and unsafe explicit IDs are absent.

**Cadence, ordering, and gate integration.**

- The first scheduled report fires after exactly 5,000 ms. After it is emitted, recurring
  reports schedule at exactly 30,000 ms. Partial reports close intervals on History API,
  `popstate`/`hashchange`, page hide, and page exit events. Hidden pages start a clean interval
  when visible again.
- The trusted adapter must supply the next non-negative safe report sequence; the sensor
  increments it monotonically across complete and partial intervals and never resets it after
  OTP.
- `handleGateEffect()` consumes only `start_observation` and `pause_observation`.
  `pause_observation` clears the timer and all accumulated evidence without emitting the
  pre-OTP interval. `start_observation` with `fresh: true` creates a new generation and empty
  accumulator after authoritative verification.
- Every in-flight report response is bound to its observation generation. A response from an
  interval paused for OTP is discarded and cannot be applied after fresh resume. Same-generation
  opaque decision candidates go only to gate-core's existing authenticity verifier and
  monotonic decision validator; out-of-order older decisions are rejected there.
- Report-send rejection is fail-open and does not stop later cadence. The sensor never creates
  an `allow`, `otp`, score, challenge success, Passport approval, or entitlement. Active OTP
  remains controlled exclusively by the Phase 9 gate state machine.

**Configuration and environment variables.** None. Inputs are browser-safe references,
the public gate-session binding, a policy-selected non-secret sensor version, a trusted
next-sequence value, injected timers/clock for deterministic testing, an injected report
transport, and the verifier-backed decision-revision callback. No environment lookup, API/site
credential, signing key, secret, or production value was added or read.

**Tests and results.**

- `@powerotp/gate-core`: build/typecheck passed; 36 tests / 10 suites, 0 failures. New tests
  cover exact 5-second/30-second timers, navigation/hide/exit reports, route/click/ID
  sanitization, directness and scroll aggregates, fixed automation indicators, invalid
  versions/sequences, monotonic ordering, out-of-order stale decisions, OTP pause,
  pre-OTP-response discard, and fresh empty resume.
- `@powerotp/contracts`: typecheck passed; 153 tests / 39 suites, 0 failures. New tests cover
  versioned environment evidence, approved indicator enums, and compile-time/runtime rejection
  of raw browser fingerprint fields.
- `npm run verify`: passed, including all workspace builds, lint/typechecking, tests, and the
  Next.js production build. No OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** None. There is no migration, seed, production sensor
asset, policy release, runtime token, credential/configuration change, remote mutation, or
deployment. The package remains library code with injected transport and no customer
activation.

**Findings, control evidence, and Phase 11 prerequisites.**

- The sanitized-telemetry table now explicitly approves only versioned sensor metadata and the
  fixed automation enum while prohibiting raw fingerprint inventories/property scans. The
  control matrix now records source-side data minimization, browser ordering/staleness, and
  deterministic sensor tests; no certification claim or "Implemented" status was added.
- A Phase 11 wrapper must instantiate one sensor per page, derive `startingSequence` from trusted
  gate/session state, provide the same-origin authenticated report bridge without exposing the
  server-only `potp_bb_*` credential, and route returned material through
  `applyDecisionRevision()`. It must not treat the report callback's opaque return value as
  authority itself.
- History instrumentation is installed only for the sensor lifetime and restored on disposal.
  Framework wrappers should also call `recordNavigation()` when their router has a more precise
  navigation signal.
- Real browser assessment ingestion remains Phase 15, scoring Phase 17, authoritative decision
  revision delivery Phase 20, and production runtime-token/activation work remains in its
  assigned later phases. Phase 11 must keep unbacked routes typed unavailable and must not
  fabricate any result.

## 2026-08-14 — BotBlocker Phase 11: raw Node HTTP wrapper

**Outcome.** Added the private `@powerotp/gate-node` workspace for Node 22 raw
`http.createServer` integrations. It continues protected application responses immediately,
verifies signed clearances locally, starts but never cancels pending decisions, exposes a
credential-free same-origin browser bridge, and composes the Phase 9 gate with the Phase 10
sensor. Unbacked central operations remain typed unavailable. No Express/Next.js wrapper,
ingestion, scoring, OTP orchestration, Passport/PaidTokenPass behavior, customer-hosted
CleanDataPage route, production activation, or remote change was added.

**Exact files.**

- Workspace/build: `package.json`, `package-lock.json`,
  `libraries/gate-node/package.json`, `tsconfig.json`, and
  `tsconfig.typecheck.json`.
- Server production:
  `libraries/gate-node/src/index.ts`, `types.ts`, `server.ts`, `http.ts`,
  `cookies.ts`, `session.ts`, `runtime.ts`, `bridge.ts`, and `discovery.ts`.
- Browser production: `libraries/gate-node/src/browser.ts`.
- Fixture/tests: `libraries/gate-node/src/fixture.ts`, `server.test.ts`, and
  `browser.test.ts`.
- Evidence: this file, `docs/THREAT_MODEL.md`, and
  `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`.

All production modules remain below 300 lines. Runtime dependencies are only the existing
`@powerotp/contracts`, `@powerotp/gate-core`, and
`@powerotp/botblocker-signing` workspaces. `happy-dom` is test-only.

**HTTP, proxy, limit, and exclusion behavior.**

The bullets below record the Phase 11 API as built at that time. Phase 13D supersedes its
selective-route and enforcement-suggesting names: current wrappers publish
`AdvisoryRequestState` for every customer application request except fixed technical exclusions
and expose no `protect` predicate.

- `createPowerOtpRequestListener()` wraps a raw Node request listener, while
  `createPowerOtpServer()` creates a Node server with `requireHostHeader` and the configured
  header-size bound. The customer handler runs immediately with `access: "optimistic"` when
  no valid clearance exists; the 50–2,000 ms timeout is passed to the already-open browser
  gate and never aborts or delays the pending server decision.
- Non-overridable exclusions cover `/_powerotp/*`, agent discovery, `OPTIONS`, standard
  health/readiness/liveness paths, and static framework/asset paths. A separate customer
  `protect(RequestContext)` predicate selects other routes. Paths, header bytes/count, cookie
  bytes, and JSON bodies have validated limits; encoded separators, backslashes, malformed
  paths, unsupported methods/content types, and oversized input are rejected with
  content-free stable errors.
- The direct socket address is authoritative by default. Forwarded IP use requires an explicit
  header, explicit first/last position, and an explicit list of trusted proxy IPs. Wildcard,
  empty, malformed, untrusted-hop, malformed-chain, and overlong forwarded values cannot
  become the client IP.
- Operational callbacks expose only fixed event categories and unavailable reasons. Errors
  never include request bodies, headers, authorization, cookies, tokens, query values, or
  customer content.

**Clearance, session, and browser authority.**

- Signed `powerotp_access` values are canonical base64url JSON and are accepted only after the
  existing Ed25519 verifier validates active/previous key trust, site, audience, exact gate
  session, issuance, and expiry. A returned clearance is issued only when its paired candidate
  independently verifies as `allow` and no challenge is active. Cookies default to
  `Secure; HttpOnly; SameSite=Lax; Path=/` with clearance expiry; insecure cookies require an
  explicit fixture/development choice.
- The default bounded single-process session store uses opaque 192-bit IDs and never evicts an
  active OTP challenge. Capacity exhaustion leaves new ordinary page access optimistic but
  cannot replace a retained active challenge. Deployments needing cross-process durability may
  inject the `GateSessionStore` interface.
- `/_powerotp/session`, `decision`, `decision/verify`, `browser-assessment`,
  `challenge/status`, and `challenge/ack` are same-origin bridge routes. Every route requires
  the non-simple `X-PowerOTP-Bridge: 1` marker; cross-site Fetch Metadata or a mismatched
  `Origin` is rejected before session creation. Mutating routes are POST with bounded strict
  JSON. Site credentials are validated server-side but never included in bootstrap, browser
  imports, cookies, discovery, event payloads, or bridge responses.
- `createGateBrowserCoordinator()` derives the sensor starting sequence and restored OTP/
  ordering state only from the HttpOnly server session bridge. Initial and report candidates
  pass through `GateController.applyDecisionRevision()` and its injected server verification
  bridge. OTP composes the page lock, authoritative status poller, and strict UX-only
  `postMessage` guard; only a site/session/challenge-bound polled `verified` result unfreezes
  the page and starts a fresh sensor interval. Server state retains active OTP until the
  browser acknowledges that applied authoritative result, so a lost poll response cannot
  downgrade a reload.

**Discovery and fixture.**

- `GET|HEAD /.well-known/powerotp-agent` returns a strict protocol-v1 POWEROTP discovery
  document. Optional CleanDataPage links must be credential-free HTTPS on `powerotp.com` or a
  subdomain. The wrapper creates no customer `/powerotp/aisummary` or CleanDataPage content
  route.
- `createGateNodeFixture()` is a minimal raw Node server that demonstrates exclusions,
  protected-route state, and typed unavailable behavior without inventing a decision or
  production service.

**Configuration names.** The wrapper accepts server-side constructor values corresponding to
`POWEROTP_SITE_ID` and `POWEROTP_SITE_CREDENTIAL`, an audience/origin, public verification
keys, timeout, route predicate, trusted-proxy settings, limits, and injected service/session
ports. It does not read `process.env`, create a value, add an `.env` entry, or expose the
`potp_bb_*` credential. Existing central `BOTBLOCKER_*` configuration remains unchanged.

**Tests and results.**

- Node 22.18.0 confirmed. `@powerotp/gate-node`: build/typecheck passed; 15 tests, 0 failures.
  Coverage includes immediate optimistic delivery with a still-pending or synchronously
  failing decision service, local clearance verification/issuance, OTP-clearance conflict,
  trusted ordering restoration, same-origin/CSRF rejection, request/body bounds, protected
  exclusions, trusted-proxy rejection, active-challenge non-eviction, strict discovery,
  typed unavailable behavior, the minimal fixture, browser report sequence derivation and
  revision application, page freeze, authoritative polling, and loss-safe OTP acknowledgement.
- Focused existing suites passed unchanged:
  `@powerotp/gate-core` 36 tests / 10 suites,
  `@powerotp/botblocker-signing` 18 tests / 6 suites, and
  `@powerotp/contracts` 153 tests / 39 suites.
- `npm run verify`: passed, including every workspace build/typecheck/test and the Next.js
  production build. No OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** None. No migration, seed, key, credential, policy
release, environment setting, DNS/configuration change, deployment, customer activation,
commit, push, or remote mutation was performed.

**Findings, limitations, and Phase 12 prerequisites.**

- Signed decision/revision production delivery still does not exist. `GateNodeServices`
  therefore defaults decision, assessment, polling, and verification to typed unavailable or
  unverified; a real service must be injected later and every candidate still crosses both
  server and gate-core validation.
- The bounded default session store is process-local. Multi-instance customers must inject a
  durable, concurrency-safe implementation before production; active OTP state must never be
  evicted or downgraded during outages.
- The optimistic-load limitation remains: immediate rendering means a late OTP cannot retract
  content already delivered before the page lock.
- Phase 12 may add only the Express middleware/router and React fixture over these shared
  contracts. It must preserve middleware ordering, proxy/stream/upload/error exclusions,
  WebSocket non-interference, credential separation, and all gate-node conformance invariants
  without starting Next.js, ingestion, scoring, OTP orchestration, or CleanDataPage work.

## 2026-08-14 — BotBlocker Phase 12: Express wrapper

**Outcome.** Added the private `@powerotp/gate-express` workspace for Express 5 and React 19.
It is a thin adapter over `@powerotp/gate-node`: protected Express handlers continue
immediately, while the shared listener retains sole ownership of sessions, signed-clearance
verification, decision startup, bridge routes, discovery, request limits, exclusions, and
authoritative OTP state. No Next.js wrapper, central decision delivery, ingestion, scoring,
OTP orchestration, customer-hosted CleanDataPage route, production activation, or remote
change was added.

**Exact files.**

- Workspace/build: `package.json`, `package-lock.json`,
  `libraries/gate-express/package.json`, `tsconfig.json`, `tsconfig.typecheck.json`, and
  `README.md`.
- Express/React production: `libraries/gate-express/src/index.ts`, `middleware.ts`,
  `react.tsx`, and `fixture.tsx`.
- Conformance tests: `libraries/gate-express/src/server.test.ts`, `security.test.ts`, and
  `react.test.tsx`.
- Shared invariant refinements: `libraries/gate-node/src/types.ts`, `http.ts`, `server.ts`,
  and `server.test.ts`.
- Evidence: this file, `docs/POWEROTP_BOTBLOCKER_PLAN.md`, `docs/THREAT_MODEL.md`, and
  `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`.

All production modules remain below 300 lines. The package adds only Express/React
requirements: Express, React, and React DOM are peers; the existing gate-node workspace is
the sole runtime dependency. Type packages and the already-used `happy-dom` are development
only.

**Express API and ordering.**

- `createPowerOtpBotBlocker(options)` accepts the shared server-only site ID/credential,
  audience, public verification keys, timeout, route predicate, trusted-proxy settings,
  limits, services, session store, discovery, event, cookie, and clock ports. It exposes a
  stable `middleware()` plus an equivalent root-mounted `router()`; applications mount one,
  not both.
- Middleware/router mounting must precede body parsers, `express.static`, SSR, protected API,
  and React handlers. This lets the shared listener own `/_powerotp/*` JSON bodies and
  discovery before customer middleware can consume or shadow them. Downstream state is
  available on `request.powerOtp` and `response.locals.powerOtp`.
- `PowerOtpBrowserGate` is the explicit React-root integration for streamed or compressed HTML.
  It accepts no site credential, starts the Phase 11 browser coordinator after mount, derives
  report sequence/restored OTP state from `/_powerotp/session`, routes all candidates through
  the verifier-backed controller, and disposes the sensor/controller on unmount.

**Streaming, uploads, errors, and WebSockets.**

- The adapter does not consume application JSON/multipart/upload streams, buffer response
  streams, inject into HTML, or rewrite compressed bodies. Path/header limits still apply
  before application routing; the body limit applies only to owned same-origin bridge JSON.
- Downstream Express error middleware remains authoritative. Errors before headers may emit
  the application's bounded error; after headers it must delegate or destroy rather than
  attempt a second response. Gate-owned failures still use the shared content-free errors.
- Node WebSocket `upgrade` events naturally bypass Express. An upgrade-shaped request that
  reaches the middleware is explicitly marked excluded and passed through without a session,
  decision, body read, or response write.

**Proxy, clearance, and session refinements.**

- The direct socket IP remains authoritative without configuration. Forwarded IP trust still
  requires an exact header, first/last selection, and explicit trusted remote proxy IPs.
  `expectedProxyCount` may now require an exact chain length (1–32); count mismatches, untrusted
  remote proxies, wildcard/empty/malformed configuration, malformed values, and overlong
  chains cannot become the client IP. Express `trust proxy` never implicitly configures this
  boundary.
- A valid signed clearance now also requires that the server session have no active OTP
  challenge. This closes the prior-clearance/active-OTP conflict: an already-issued challenge
  remains authoritative and fail-open dependency behavior cannot restore clearance access.
- The default bounded store remains process-local and active-OTP sessions remain non-evictable.
  Express cluster/multi-instance deployments must inject a bounded concurrency-safe shared
  `GateSessionStore`; this package makes no durability claim for the default.

**Security and discovery behavior.**

- The adapter preserves exactly `allow | otp`, immediate optimistic behavior, typed unavailable
  defaults, local Ed25519 site/session/audience/time verification, hardened private cookies,
  same-origin bridge marker/Fetch Metadata/Origin controls, authoritative challenge polling,
  loss-safe acknowledgement, and strict protocol-v1 discovery.
- Server configuration is constructor-injected; the package does not read `process.env`.
  Site credentials, signing keys, environment values, authorization, cookies, query values,
  request bodies, and customer content are absent from browser props, fixture markup,
  discovery, bridge responses, and fixed-category events.
- Optional CleanDataPage discovery still permits only POWEROTP-hosted HTTPS links. Neither the
  package nor its fixture creates `/powerotp/aisummary` or customer CleanDataPage content.

**Tests and results.**

- `@powerotp/gate-express`: build/typecheck passed; 22 tests, 0 failures. Coverage includes
  middleware ordering before static/SSR/API/React routes, infrastructure/static/health/OPTIONS
  exclusions, direct and explicitly trusted proxy modes/count/position/header behavior,
  forwarding spoof rejection, immediate pending/rejecting/throwing service behavior, late
  allow/OTP, signed-clearance binding/expiry/conflict, same-origin CSRF, bounded malformed
  inputs, JSON/multipart non-interference, streaming/compressed responses, pre/post-header
  errors, WebSocket upgrades, strict discovery, credential absence, React fixture lifecycle,
  trusted sensor sequence, and decision-revision application.
- `@powerotp/gate-node`: 16 tests, 0 failures, including the new active-OTP/prior-clearance
  regression. Focused `@powerotp/gate-core`, `@powerotp/botblocker-signing`, and
  `@powerotp/contracts` suites passed unchanged.
- `npm run verify`: passed, including every workspace build/typecheck/test and the Next.js
  production build. `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** None. No migration, seed, key, credential, environment
setting, policy release, DNS/configuration change, deployment, customer activation, commit,
push, or remote mutation was performed.

**Findings, limitations, and Phase 13 prerequisites.**

- Signed decision/revision production delivery still does not exist. Injected Express services
  remain verifier-backed boundaries; defaults return typed unavailable and fabricate nothing.
- Immediate optimistic rendering still cannot retract content delivered before a late OTP page
  lock. Application-layer wrappers also cannot protect traffic that bypasses the process;
  customers must restrict direct-origin access independently.
- Phase 13 may add only the Next.js native `proxy.ts`/App Router wrapper, root gate component,
  owned same-origin handlers, and strict discovery over these shared contracts. It must test
  App Router navigation, server/client and runtime boundaries, assets, CSP/iframe behavior,
  streaming, and bundle credential absence without starting MCP generation, ingestion,
  scoring, OTP orchestration, or CleanDataPage work.

## 2026-08-14 — BotBlocker Phase 13: Next.js wrapper

**Outcome.** Added the private `@powerotp/gate-next` workspace for the installed Next.js 16.3
App Router and React 19. The adapter is a thin native Web Request/Response bridge over
`@powerotp/gate-node`, so the shared implementation remains authoritative for sessions,
signed clearances, decision verification, limits, exclusions, same-origin bridge behavior,
discovery, active OTP persistence, and typed unavailable defaults. No MCP generator,
ingestion, scoring, OTP orchestration, customer-hosted CleanDataPage, production activation,
or remote change was added.

**Exact files and package surface.**

- Workspace/build: `package.json`, `package-lock.json`, `libraries/gate-next/package.json`,
  `tsconfig.json`, `tsconfig.typecheck.json`, and `README.md`.
- Production: `libraries/gate-next/src/index.ts`, `adapter.ts`, `react.tsx`, and `csp.ts`.
- Conformance: `adapter.test.ts`, `security.test.ts`, `react.test.tsx`, plus the minimal real
  Next fixture under `libraries/gate-next/fixture/`.
- Evidence: this file, `POWEROTP_BOTBLOCKER_PLAN.md`, `THREAT_MODEL.md`, and
  `POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`.

All production modules remain below 300 lines. `@powerotp/gate-node` is the only runtime
dependency; Next.js/React/React DOM are peers. `createPowerOtpNext(options)` exposes
`proxy(request, event)` and `route(request)`, while `PowerOtpNextGate` is the credential-free
root Client Component and `withPowerOtpFrameSource()` safely merges only a validated
POWEROTP-hosted HTTPS iframe origin into an existing CSP.

**Next.js integration and runtime boundaries.**

- Native `proxy.ts` returns `NextResponse.next()` immediately for protected pages, APIs, and
  Server Action requests. It uses Next.js 16's Node-only Proxy runtime and
  `NextFetchEvent.waitUntil()` to keep the shared pending decision alive without tying it to
  the 50–2,000 ms UX timeout. Proxy has no `runtime` export because Next.js 16 rejects one.
- The static matcher excludes `/_powerotp/*`, discovery, framework/static/assets, common
  public-file extensions, and health/infrastructure paths before filesystem/App Router
  resolution. The adapter independently excludes `OPTIONS`, so direct invocation cannot
  create a session or start a decision.
- Next reserves literal underscore-prefixed App Router folders as private. The required source
  path is therefore `app/%5Fpowerotp/[...path]/route.ts`; the emitted public URL is the required
  `/_powerotp/*`. Route handlers and discovery explicitly declare `runtime = "nodejs"` and
  delegate to the singleton server-only adapter.
- The Proxy adapter never reads protected request bodies or customer response streams and
  performs no HTML injection. The root Client Component is the explicit integration for
  streamed/compressed App Router rendering and remains mounted across client navigation.
- The production fixture builds routes for `/_powerotp/[...path]`,
  `/.well-known/powerotp-agent`, a protected API, a health route, and the root gate. The
  generated client chunks are scanned for the fixture credential, credential prefix, and
  environment-variable name.

**Security behavior.**

- Next.js does not expose a socket address on `NextRequest`; the default therefore omits
  `clientIp` and trusts no forwarding header. `resolveDirectAddress` accepts only a
  deployment-authenticated direct peer value supplied by the integrator. Forwarding still
  requires the shared exact header, explicit first/last selection, explicit trusted peer IPs,
  and optional exact 1–32 proxy count. Wildcard trust and forwarding spoof attempts fail.
- Site credentials and environment access exist only in the server configuration module.
  Browser bootstrap, discovery, bridge responses, cookies, fixture HTML, and production client
  chunks contain no site credential. The public site ID authorizes nothing.
- Every decision candidate still crosses the injected authenticity verifier and gate-core's
  site/session/audience/time/sequence/nonce checks. A signed clearance is accepted only for its
  bound session and cannot override an active OTP. Returned clearance is issued only after both
  decision and clearance verification, with Secure/HttpOnly/SameSite=Lax attributes.
- The shared non-simple bridge marker, Fetch Metadata/Origin checks, bounded JSON parser,
  authoritative challenge polling, and loss-safe acknowledgement apply unchanged. Dependency
  failure remains optimistic only for ordinary traffic and cannot clear an active OTP.
- The page lock accepts only credential-free HTTPS challenge metadata. `postMessage` remains a
  UX polling trigger and never unlocks. CSP merging rejects wildcard/non-POWEROTP origins and
  preserves the customer's other directives. Hosted `frame-ancestors` remains a POWEROTP-side
  response responsibility.
- Discovery remains protocol-v1 and may contain only validated POWEROTP-hosted HTTPS
  CleanDataPage metadata. No `/powerotp/aisummary` or customer CleanDataPage route exists.

**Tests and results.**

- `@powerotp/gate-next`: production/typecheck passed; 18 tests, 0 failures. Coverage includes
  native matcher/App Router ordering, protected pages/APIs, framework/static/health/OPTIONS
  exclusions, immediate pending/rejecting/throwing behavior, `waitUntil`, direct/forwarded IP
  trust and spoof rejection, upload non-consumption, same-origin CSRF, malformed/oversized
  bridge input, strict discovery, signed clearance/active-OTP conflict, verified late
  clearance issuance, late OTP persistence/polling/acknowledgement, App Router-style
  navigation and sensor sequence, CSP/iframe/postMessage behavior, source and client-bundle
  credential absence, and invalid trust-all startup rejection.
- The real Next.js 16.3 Turbopack production fixture build passed and emitted both native Proxy
  and the required public App Router routes. Focused Express, raw Node, gate-core, signing, and
  contracts suites passed unchanged.
- `npm run verify`: passed, including both Next.js production builds and every workspace
  build/typecheck/test. `npm audit`: 0 vulnerabilities. Final `git diff --check`: clean.

**Manual/migration/deployment steps.** None. No migration, seed, key, credential, environment
setting, policy release, DNS/configuration change, deployment, customer activation, commit,
push, or remote mutation was performed.

**Findings, limitations, and Phase 14 prerequisites.**

- Signed production decision/revision delivery still does not exist. Injected Next services
  remain verifier-backed boundaries; defaults return typed unavailable and fabricate nothing.
- The default store remains process-local. Multi-instance/serverless customers require an
  injected bounded concurrency-safe store that preserves active OTP; this phase makes no
  durability claim for the default.
- Immediate optimistic rendering cannot retract content already delivered before a late page
  lock. Application-layer adapters cannot protect direct-origin traffic that bypasses Next.
- NextRequest's lack of a socket address is an explicit platform limitation, not a reason to
  trust arbitrary forwarding headers. Deployments without an authenticated direct-peer
  resolver operate without `clientIp`.
- Phase 14 may add only the public anonymous read-only MCP generator and versioned/checksummed
  manifests for the completed raw Node, Express, and Next wrappers. It must not begin real
  ingestion, matching, scoring, OTP orchestration, production activation, or CleanDataPage
  implementation.

## 2026-08-14 — BotBlocker Phase 13A: plugin-state boundary specification recovery

**Outcome.** Specification-only correction (documentation plus one non-runtime contract
comment). This phase correctly removed automatic POWEROTP rendering/DOM control, but it
incorrectly recorded an additional expectation that installed customer code would enforce fixed
rendering/access mappings. The user later clarified the narrower boundary: adapters/providers
publish advisory state only, supported integration code never enforces it, and customer code
alone decides whether and how to act. This entry preserves what Phase 13A changed while the
current-status section and Phase 13D correction record the authoritative semantics.

This phase also fixed OTP launch ownership. Customer code receives an `otp` recommendation and
may call exactly one argument-free `gate.openOtp()` API. The caller cannot select the OTP
method, policy, or iframe content. POWEROTP validates the authenticated site/session decision
server-side, resolves the visitor gate session to its internal user-intelligence record,
selects what the hosted iframe shows, and returns only short-lived launch metadata. Initial
RapidAuth uses the site credential to mint a scoped token stored by the adapter. The empty
same-origin request relies on the HttpOnly local gate-session cookie, and the customer server
forwards only that narrow token upstream.

**Why this correction was required.**

- The original plan commit `139c3ef` described the adapter running before customer handlers,
  but later progressive-phase text mixed that concept with optimistic rendering.
- Commit `52cce5e` explicitly reconciled the product to an automatic optimistic/page-lock
  model. Phases 9–13 then correctly implemented that written specification, including
  automatic DOM freeze behavior.
- The user confirmed that automatic POWEROTP DOM control was the wrong product boundary. Phase
  13A removed that behavior but still overstated supported integration behavior by calling
  customer enforcement expected. The authoritative correction is state publication only:
  customer behavior is neither generated, required, assumed, nor verified by POWEROTP.
- Historical Phase 0–13 entries remain unchanged as evidence of what was actually specified
  and built. This entry supersedes their product-intent claims without falsifying history.

**Exact files changed.**

- `docs/POWEROTP_BOTBLOCKER_PLAN.md`: rewrote Purpose, invariants, system flow, Gate Adapter,
  browser SDK/OTP opener, initial adapters, and failure/security rules around customer-owned
  rendering and the single server-selected OTP launch.
- `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`: corrected the end goal and Phase 0/9/19/20
  descriptions; inserted corrective Phases 13A–13D without renumbering 14–31.
- `docs/THREAT_MODEL.md`: at the time, replaced the optimistic enforcement claim with a
  plugin-instruction/customer-enforcement boundary; that intermediate wording is now superseded
  by the state-publication/customer-control boundary.
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`: records the identified Phase 9–13
  implementation gap without claiming the corrective code exists.
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`: current-status clarification and this entry.
- `backend/packages/contracts/src/botblocker.ts`: corrected the timeout comment/reference; no schema,
  type, constant, wire shape, or runtime behavior changed.

**Product semantics recorded by Phase 13A, corrected to the current state-only boundary.**

- Middleware attaches trusted framework-native request/session state, communicates
  server-to-server with the site credential for first contact and narrow server-held visitor
  tokens thereafter, and leaves customer handlers, bodies, streams, routes, SSR, and responses
  untouched.
- The browser SDK collects only approved evidence and publishes recommendation snapshots.
  Snapshot labels describe POWEROTP's recommendation and cause no customer-content effect.
- Customer code alone decides whether and how to use a recommendation. Pre-content behavior,
  SSR/data-fetch policy, routing, and rendering are not supplied or prescribed by the adapter.
- Exactly `allow | otp` are backend decisions. `checking`, fail-open, unavailable, and
  observing are lifecycle states, not third decisions.
- The customer-configured 50–2,000 ms timeout publishes fail-open access state and never
  cancels pending work. A verified late `otp` replaces the recommendation.
- The first report remains five seconds after access state permits normal observation,
  recurring reports remain every 30 seconds, and every real later backend update may revise
  the recommendation.
- POWEROTP does not automatically freeze/unfreeze customer DOM. Monitoring pauses only after
  the customer explicitly invokes `openOtp()` and resumes after authoritative success.
- `openOtp()` accepts no API key, session/site/user-intelligence ID, method, policy, content, or
  challenge argument. The SDK sends an empty same-origin request; the HttpOnly cookie binds the
  visitor, the adapter retrieves its server-held scoped token, and POWEROTP resolves the
  gate-session relationship server-side.
- Session and public site IDs identify records but authorize nothing. Initial RapidAuth mints a
  token that is sufficient for that visitor's later approved operations only because it is
  short-lived, revocable, site/session/audience-bound, and server-held.
- Initial browser evidence remains bounded/sanitized. Browser-supplied raw fingerprint hashes
  remain forbidden; Phase 15 derives keyed fingerprint/IP lookup hashes server-side.

**Tests and verification at the time.** No runtime code or contract changed, so no runtime suite was
required for this specification-only phase. Cross-document/source-comment searches confirmed
no current product specification still claimed that POWEROTP automatically controlled customer
rendering. The later state-only clarification additionally removed the mistaken expectation of
customer enforcement from current normative documents.
`npm run typecheck -w @powerotp/contracts` passed; `git diff --check` was clean.

**Manual/migration/deployment steps.** None. No runtime code, dependency, migration, seed,
environment setting, key, credential, policy release, DNS/configuration, deployment, customer
activation, commit, push, or remote service was changed.

**Phase 13B prerequisites and exclusions.**

- Phase 13B must add strict initial proof/evidence and public recommendation snapshots,
  subscribe/getSnapshot state access, and the single argument-free `openOtp()` call.
- It must remove automatic page-lock/iframe DOM effects from the default browser coordinator
  while preserving verifier-backed revisions, timeout-with-pending-work, 5-second/30-second
  sensing, polling, acknowledgement, and credential separation.
- It must prove the opener accepts an empty body only, relies on the HttpOnly session rather
  than caller IDs, and cannot expose or accept the site credential.
- Phase 13B must not redesign server adapters, implement MCP, ingest real intelligence, derive
  fingerprints, score visitors, orchestrate production OTP, activate customers, or start
  Phase 13C or later work.

## 2026-08-15 — BotBlocker Phase 13B: advisory browser contracts and state API

**Outcome.** Replaced the automatic browser page-lock boundary with a strict advisory state
API. `@powerotp/gate-core` now publishes immutable recommendation snapshots through
`getSnapshot()` and ordered `subscribe()` notifications. Snapshots structurally separate
restricted/full-access/OTP-required recommendations from lifecycle and the only two verified
backend decisions, `allow | otp`; timeout and network failure publish fail-open lifecycle
without fabricating `allow`, and pending work continues so a late verified `otp` still wins.

Customer code now has one zero-argument `openOtp()` action. Receiving `otp` changes only the
published recommendation: it does not alter customer DOM, pause sensing, open an iframe, or
start polling. Explicit invocation sends a bodyless same-origin request using the HttpOnly gate
session. The bridge requires an already verifier-backed server session with an active `otp`,
rejects caller options/IDs, and returns only the existing server-selected credential-free HTTPS
challenge metadata. Only then does the browser reuse the existing page-lock, UX-only
`postMessage`, authoritative poller, and loss-safe acknowledgement primitives.

**Contracts and security boundaries.**

- Added strict initial browser proof/evidence contracts reusing bounded sanitized evidence,
  signed clearance, Passport assertion, and PaidTokenPass assertion shapes. Unknown fields,
  raw browser fingerprint hashes, unsigned clearance, and self-declared approval remain
  rejected.
- Added a closed recommendation-snapshot union whose valid lifecycle/recommendation/decision
  combinations are enforced by schema rather than convention. Fail-open and unavailable carry
  no backend decision.
- Added strict empty opener and server-selected launch metadata contracts. Launch metadata
  contains only challenge ID, credential-free HTTPS URL, and matching approved origin; no OTP
  method, policy, content selector, site credential, API key, or authorization token is
  browser-visible.
- Existing site/session/audience/expiry/sequence/nonce validation remains verifier-backed.
  Restored OTP remains advisory on reload and requires a fresh explicit `openOtp()` call before
  the page lock and polling resume.
- Polling failure retains OTP state; `postMessage` can only prompt a poll; only a correctly
  bound authoritative status publishes verified full access. Server challenge state remains
  retained until acknowledgement.

**Sensor behavior.** The existing first report at five seconds, recurring reports every
30 seconds, navigation/hide/exit partial reports, evidence sanitization, and stale response
rejection remain unchanged. An early OTP never starts observation. A late OTP leaves existing
observation running. Observation pauses only after successful explicit OTP opening and resumes
as a fresh interval only after authoritative success.

**Files and compatibility.** Added `backend/packages/contracts/src/botblocker-browser.ts` and its
tests plus `libraries/gate-core/src/recommendation.ts`. Updated the shared controller, state
helpers, raw Node browser coordinator and bounded bridge, and focused tests. Express and Next
request/middleware behavior was not redesigned; their security and React tests were updated
only to prove compatibility with explicit opening and zero automatic DOM effects.

**Verification.** Focused contracts, gate-core, gate-node, Express, and Next suites pass,
including production Next bundle credential scanning. Full `npm run verify` passed after
building every workspace and running repository-wide lint/typechecking and tests. `npm audit`
reported zero vulnerabilities. Final `git diff --check` passed.

**Exclusions and operations.** No real RapidAuth/intelligence ingestion, fingerprint/IP
derivation, scoring, production signed-decision delivery, OTP orchestration, Passport,
PaidTokenPass, billing, deployment, DNS, secret, activation, policy publication,
customer-hosted CleanDataPage, Phase 13C, Phase 13D, or Phase 14 work was added. No migration,
seed, environment/configuration change, remote mutation, commit, or push was performed.

## 2026-08-15 — BotBlocker Phase 13C: shared Node and Express advisory adapters

**Outcome.** Made `@powerotp/gate-node` the shared server authority for raw Node and Express
advisory integrations. At the time, a customer-selected request received framework-native
recommendation state immediately and remained fully customer-controlled. The later Phase 13D
state-only correction removed that selector so every customer application request receives
advisory state except fixed technical exclusions. The owned same-origin bridge first
accepts the strict Phase 13B initial proof/evidence shape, verifies a correctly bound signed
clearance locally when present, and only then starts the initial decision contact. Timeout
publishes a real `fail_open` snapshot while the same server Promise remains pending; a late
verifier-backed `allow` or `otp` replaces it. Active OTP state cannot be replaced by timeout,
clearance, or a later `allow`.

**Credential and visitor-token boundary.** The initial service call receives sanitized browser
evidence, trusted path/method/IP context, and the server-only site credential. A successful first
contact must return a bounded opaque visitor token. Gate Node stores that token only in the
server-side gate session and removes it, clearance material, and challenge internals from browser
decision responses. Subsequent browser assessment, explicit OTP launch, and authoritative polling
service calls receive only the scoped token; a repeated decision request cannot resend the site
credential. The first customer application request context is retained until first contact, so an
intervening subresource cannot replace its trusted path/method/IP. Unconfigured, malformed, or
synchronously failing service behavior is reduced to the strict typed-unavailable shape rather
than fabricating `allow` or echoing extra credential/token fields.

**Advisory state and non-interference.** Raw Node handlers receive a closed Phase 13B
recommendation snapshot alongside the existing request state. Verified local clearance maps to
full-access/allow recommendation state; fresh sessions map to restricted/checking; timeout maps
to full-access/fail-open without a backend decision; verified decisions map only to `allow | otp`.
The Express middleware remains a thin delegation layer that copies this state to
`req.powerOtp` and `res.locals.powerOtp`. It does not consume customer bodies, rewrite routes,
buffer or mutate responses/streams, control SSR/APIs, or alter DOM. Browser
`subscribe`/`getSnapshot`, the argument-free bodyless `openOtp()`, explicit-only iframe opening,
sensor cadence, sequence/nonce/audience/site/session/expiry checks, polling, and acknowledgement
remain unchanged.

**Tests and compatibility.** Added coverage for bounded initial evidence and prohibited raw
fingerprint fields, first-contact credential use, server-held token forwarding and
non-disclosure, verified local clearance state, timeout with surviving pending work, late allow,
late OTP, active-OTP precedence, raw Node request-body/route/stream ownership, Express/raw Node
state conformance, unavailable-response secret stripping, synchronous launch failures, stable
first-contact context, typed unavailable defaults, trusted proxies, and same-origin bridge controls.
Express upload, streaming, compressed-response, error, WebSocket, SSR/API/static, and React
advisory tests remain green. Shared-export compatibility updates and tests pass for Next.js,
including production bundle credential scanning; Phase 13D request/provider work was not added.

**Verification.** Focused contracts, gate-core, gate-node, Express, and affected Next
compatibility suites passed. Full `npm run verify` passed, including all workspace builds,
lint/typechecking, repository tests, and the production Next fixture build. `npm audit` reported
zero vulnerabilities. Final `git diff --check` passed.

**Exclusions and operations.** No real RapidAuth/intelligence ingestion, fingerprint/IP hash
derivation, scoring, production OTP orchestration, Passport/PaidTokenPass behavior, billing,
deployment, DNS, secret, activation, policy publication, customer-hosted CleanDataPage,
Phase 13D provider integration, or Phase 14 MCP work was added. No migration, seed, environment
or server configuration, remote mutation, commit, push, or deployment was performed.

## 2026-08-15 — BotBlocker Phase 13D: Next.js advisory adapter and cross-wrapper conformance

**Outcome.** Completed the native Node-runtime Next.js 16 Proxy integration over the shared
`@powerotp/gate-node` authority. Customer App Router requests now receive a bounded
framework-native recommendation/session state through a Next request-header override. Proxy
replaces caller-supplied state before forwarding a server-authenticated value, never adds it to
the browser response, and `getRequestState()` reduces missing, malformed, forged, or modified
values to a typed `unavailable`/`full_access` snapshot. Proxy still returns
`NextResponse.next()` without rewriting, redirecting, consuming an application body, buffering a
response, or controlling customer SSR, routes, APIs, Server Actions, uploads, streams, errors,
or rendering.

**State-only correction.** Removed the former customer `protect(context)` selector from the
shared Node options and all wrappers. Every customer application request now receives advisory
state except fixed owned, infrastructure, static, health, `OPTIONS`, and WebSocket exclusions.
Renamed the framework contract from enforcement-suggesting
`ProtectedRequestState`/`protected`/`access` to
`AdvisoryRequestState`/`advisory`/`status`. These are API corrections before Phase 14 generates
public integrations; no adapter gains authority over customer behavior.

**Documentation-source audit.** The repeated bad guidance was traced to Phase 13A wording that
correctly removed automatic POWEROTP DOM control but incorrectly said supported customer
integrations were expected to enforce fixed recommendation mappings. That wording propagated
into the plan, phase schedule, threat model, control matrix, and Phase 13D fixture instructions.
All current normative documents and wrapper READMEs now state the narrower rule: POWEROTP
publishes state only and neither generates nor prescribes customer action. Historical Phase
0–13 entries remain as history but are explicitly marked superseded where their API or product
claims could be mistaken for current instructions. Runtime Phases 13B–13C were already
non-interfering; the remaining code correction removed the selective-route callback and renamed
the misleading framework-state surface before Phase 14 can publish it.

**Provider and customer control.** Added the credential-free `PowerOtpNextProvider` and
`usePowerOtp()` hook over the Phase 13B `getSnapshot`/`subscribe` external-store contract.
Snapshots retain checking/restricted, fail-open/full-access, verified allow/full-access, and
OTP-required semantics in subscription order across App Router navigation. The fixture requests
advisory state for every customer application request but always renders customer children
untouched. It does not block, hide, replace, or branch customer content and does not call
`openOtp()` automatically. The provider exposes the single argument-free method so customer code
can explicitly call it when the customer chooses; no checking, access, OTP, button, or other
placeholder screen is introduced. The prior no-children `PowerOtpNextGate` mount remains
compatible.

**Shared authority and secrets.** Next first contact uses bounded initial evidence, the retained
trusted request context, and the server-only site credential. The returned scoped visitor token
remains solely in the injected server session and only that token reaches later assessment,
challenge-launch, and polling service calls. Browser responses, React props, hydration state,
and production client chunks contain neither credential nor token. Local clearance, checking,
timeout fail-open with surviving pending work, late allow, late OTP, active-OTP precedence,
sequence/nonce/site/audience/session/expiry verification, sensor cadence, polling,
acknowledgement, trusted-proxy rules, and same-origin bridge controls continue to come from the
shared Node implementation.

**Tests and compatibility.** Added native Proxy state replacement/default tests, App Router
provider/hook ordered snapshot tests, state-only fixture non-interference, an explicit
bodyless `openOtp()` test, local-clearance and active-OTP state propagation, first-contact
credential/later-token separation, timeout/pending/late allow and late OTP coverage, and
production bundle credential/token scanning. Customer-owned page, API, Server Action, upload,
stream, and error behavior is exercised without rewrites or response mutation. A behavioral
conformance suite now compares raw Node, Express, and Next state from the same shared authority;
infrastructure/static/health/`OPTIONS`/WebSocket exclusions and trusted proxy/same-origin tests
remain green.

**Verification.** Focused contracts (159 tests), gate-core (39), gate-node (21), gate-express
(22), and gate-next (27) suites passed. The production Next fixture built successfully and the
fresh client bundle scan found no site credential, credential environment name, scoped-token
literal, or `visitorToken` identifier. Full `npm run verify` passed, including workspace builds,
lint/typechecking, repository tests, and the production fixture build. `npm audit` reported zero
vulnerabilities. Final `git diff --check` passed.

**Exclusions and operations.** No Phase 14 MCP, real RapidAuth/intelligence ingestion,
fingerprint/IP hash derivation, scoring, production OTP orchestration, Passport/PaidTokenPass
behavior, billing, deployment, secrets, DNS, activation, policy publication, or customer-hosted
CleanDataPage route was added. No migration, seed, environment/server configuration, remote
mutation, commit, push, or deployment was performed.

## 2026-08-15 — BotBlocker Phase 14: public MCP generator

**Outcome.** Added public, anonymous, read-only, credential-free BotBlocker MCP resources and
tools to the existing `@powerotp/mcp` package alongside the unrelated OTP-platform MCP content,
which is untouched and remains fully compatible (`content.test.ts` and its two describe blocks
still pass unchanged). The new capability set is a documentation/generator layer only: it adds no
new backend service, credential, account-management action, or repository/dashboard/hosting
mutation. `backend/apps/server/app/mcp/route.ts` exposes it automatically because it already delegates to
`createMcpTransport()` in `@powerotp/mcp/mcp-app.js`, which now also calls
`registerBotBlockerCapabilities()`.

**Resources added** (`powerotp://botblocker/docs/*`): `architecture` (the `allow | otp`
decision boundary, lifecycle-to-recommendation mapping, shared `@powerotp/gate-node` authority,
argument-free `openOtp()`, timeout fail-open, active-OTP precedence, and the fixed technical
exclusion list) and `data-boundary` (site-credential/scoped-visitor-token flow, what the browser
never receives, MCP's own public/anonymous/read-only/credential-free boundary and prohibited
actions, customer ownership of SSR/APIs/routes/responses/rendering, and the direct-origin-bypass
limitation). Both are static content generators over facts already true of shipped Phase
13B–13D code; neither adds new runtime behavior.

**Tools added:** `list_botblocker_adapters`, `get_botblocker_environment_variables`,
`get_botblocker_manifest`, `get_botblocker_integration_steps`, `get_botblocker_troubleshooting`,
`get_botblocker_upgrade_instructions`, and `verify_botblocker_manifest_checksum`. Every tool has
a strict Zod `inputSchema`, `readOnlyHint: true`/`destructiveHint: false` annotations matching the
existing OTP tools' convention, and accepts no credential as an argument.
`get_botblocker_manifest`'s handler additionally parses its own return value through a strict
`.strict()` Zod `AdapterManifestSchema` before responding, so a future builder-shape regression
fails loudly instead of silently widening the public contract.

**Manifest generator.** New `backend/packages/mcp/src/botblocker/` module:
`manifest.ts` (`buildBotBlockerManifest`/`buildAllBotBlockerManifests`), `types.ts`, `schemas.ts`,
`checksum.ts` (SHA-256 helper), `env.ts` (environment-variable name catalog), `architecture.ts`
(resource content), `tools.ts` (registration), and one template module per adapter under
`templates/` (`node-http.ts`, `express.ts`, `nextjs.ts`). Each adapter manifest carries a
`manifestFormatVersion` (bumped only when the manifest *shape* changes) and a `packageVersion`
copied from the matching `libraries/gate-*` package.json — `manifest.test.ts` reads that real
file at test time and fails if a bumped wrapper version is not reflected, preventing a silently
stale manifest. Every file gets its own `checksumSha256`, and the whole manifest gets one more
`checksumSha256` over an explicit, fixed-order canonical string (adapter, package@version, format
version, then every `path:checksum` pair) rather than `JSON.stringify` object-key order, so the
checksum is reproducible independent of property insertion order.

**Templates match current APIs exactly.** All three templates were written directly from the
already-shipped, already-tested Phase 13C/13D fixtures/READMEs rather than reinvented: raw Node
wraps `createPowerOtpRequestListener`/`AdvisoryRequestState` from `@powerotp/gate-node`; Express
uses `createPowerOtpBotBlocker` mounted before body parsers/static/API routers exactly as
`libraries/gate-express/README.md` documents, plus `PowerOtpBrowserGate` from
`@powerotp/gate-express/react`; Next.js reproduces `powerotp.server.ts`, the literal `proxy.ts`
matcher, both `app/%5Fpowerotp/[...path]/route.ts` and `app/.well-known/powerotp-agent/route.ts`,
and the `PowerOtpNextProvider`-wrapped `app/layout.tsx` from `libraries/gate-next/fixture` and
`README.md`. The Next.js matcher literal is a local copy checked against
`@powerotp/gate-next`'s own exported `POWEROTP_PROXY_MATCHER` constant by a dedicated
`templates/nextjs.test.ts` drift test rather than imported at runtime, so this documentation
package never needs `next`/`react` as an actual runtime dependency (only as `devDependencies` for
the compile-check test below). None of the three services (`requestDecision`, `verifyDecision`,
`assessBrowser`, `launchChallenge`, `pollChallenge`) are wired to a real backend by any shipped
wrapper yet, so every generated example's "known limitations" says plainly that traffic observes
typed-unavailable/fail-open state only until a real service is injected — this is not a Phase 14
regression, it is accurately describing Phase 13's own already-shipped default.

**Environment variables corrected mid-phase after user review.** The first draft of `env.ts`
invented `POWEROTP_VERIFICATION_KEY_ID`/`POWEROTP_VERIFICATION_PUBLIC_KEY_SPKI_BASE64` as if they
were intended customer-facing setup, and entirely missed `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s
already-specified "OTP integration" section. The user's actual, already-partially-shipped
credential model is exactly two per-project secrets: a site/project API key and a webhook signing
secret, both generated once and independently rotatable. Corrected `env.ts` now separates three
groups instead of one flat list:

- `BOTBLOCKER_ENV_VARS` (required, real, shipped): `POWEROTP_SITE_ID` and
  `POWEROTP_SITE_CREDENTIAL`. The credential is exactly the value already returned once by the
  real, shipped `POST /v1/projects/{projectId}/botblocker/rotate-site-credential`
  (`backend/packages/api/src/botblocker-site-credential-service.ts`, Phase 8) — MCP now points to that real
  endpoint by name in every adapter's placement steps instead of inventing a dashboard flow.
- `BOTBLOCKER_PLANNED_ENV_VARS`: `POWEROTP_WEBHOOK_SIGNING_SECRET`, specified in
  `POWEROTP_BOTBLOCKER_PLAN.md`'s "OTP integration" section (256-bit, per project, shown once,
  rotatable, verifies the fixed `/_powerotp/webhooks/challenge-status` callback) but not backed
  by any shipped rotation service or webhook receiver in any adapter yet. Documented as planned,
  not generated as fake receiver code.
- `BOTBLOCKER_UNDELIVERED_ENV_VARS` (renamed from an initial, incorrect
  `BOTBLOCKER_UNRESOLVED_ENV_VARS`): the same Ed25519 `POWEROTP_VERIFICATION_KEY_ID`/
  `_PUBLIC_KEY_SPKI_BASE64` pair. The first correction round mischaracterized this as possibly
  unwanted complexity; the user then confirmed it is an intentional, wanted feature — a returning
  visitor who already received an `allow` gets a signed, long-lived cookie
  (`libraries/gate-node/src/cookies.ts`'s `verifyClearanceCookie()`, from Phase 3 "Ed25519
  signed-artifact primitive"), and a later visit's `allow` is granted instantly by checking that
  cookie's signature entirely on the customer's own server, without waiting on a fresh decision
  or even reaching PowerOTP (this also keeps working through a PowerOTP outage, matching the
  already-documented `THREAT_MODEL.md` fail-open-timeout section). An active OTP challenge or a
  revoked/replaced clearance always takes precedence over this cookie, matching Phase 13C/13D's
  already-tested active-OTP precedence. The real, narrower, still-open gap: no dashboard/API flow
  yet hands a customer the specific public value their server needs to check that signature, the
  way the real `rotate-site-credential` endpoint already hands them the site credential — most
  naturally an extension of the already-shipped, public `GET /v1/botblocker/policy/{siteId}`,
  whose current contract (`backend/packages/contracts/src/botblocker-policy.ts`) carries only a key-*ID*
  reference, not key bytes. Every adapter's generated `powerotp.server.ts`/`server/powerotp.ts`
  file still includes the field (it is real, required, and non-optional on the shipped
  `GateNodeOptions` type, so omitting it would not compile), now with a comment and a
  `knownLimitations` entry describing it as "required-but-not-yet-deliverable" and pointing at
  `get_botblocker_environment_variables`'s output for detail. Phase 14 made no runtime code
  change and did not build the key-delivery mechanism itself.

> Superseded target semantics: this paragraph records the earlier session-bound clearance design.
> The approved persistent credential is now `powerotp_site_return`, bound to one
> `userIntelligence` row across sessions. It grants immediate local access while active reporting
> starts and may later be revoked or replaced by an OTP recommendation. The Phase 17 plans are
> authoritative for future implementation.

**Automatic key delivery scheduled as Phase 14A, not left as a flagged runtime anomaly.** The
user's final correction: not-yet-built simply means "an upcoming phase," and it belongs in the
main plan on the appropriate phase, with current-phase docs noting the hand-off — not framed as
an "unavailable"/"open question" oddity in tool output. Added
`### Phase 14A — Automatic verification-key delivery` to
`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md` (between Phase 14 and Phase 15, following the same
lettered-insertion convention as Phases 13A–13D, so Phases 15–31 keep their numbers): extend the
already-shipped Phase 7 policy release/`GET /v1/botblocker/policy/{siteId}` to carry the actual
Ed25519 public key material instead of only a key-*ID* reference, and add a policy-fetch client
to the shared `@powerotp/gate-node` authority that resolves `verificationKeys` automatically from
only the public `siteId` — implementing the "Signed Policy Client" that
`POWEROTP_BOTBLOCKER_PLAN.md` already specified conceptually but that no wrapper ever
implemented. Cross-referenced Phase 7's own phase description and `PLAN.md`'s "Signed Policy
Client" section and example snippet to point at Phase 14A. Reworded every Phase 14 MCP touchpoint
(`env.ts`, `tools.ts`, `architecture.ts`, all three adapter templates, and their tests) from
"required-but-not-yet-deliverable"/"open architecture question" to a plain, matter-of-fact
statement: the constructor takes this value directly today, and Phase 14A will resolve it
automatically later. `BOTBLOCKER_UNDELIVERED_ENV_VARS`'s export name and doc comment were kept
accurate but their customer-facing description text no longer reads as a discovered problem.

**Tests and results.** New `backend/packages/mcp/src/botblocker/{manifest,typecheck}.test.ts` and
`templates/nextjs.test.ts` join the existing `content.test.ts`, for 41 total `@powerotp/mcp`
tests, 0 failures. Coverage includes: strict output-schema validation; byte-for-byte
reproducibility across independent builds; manifest checksum recomputation; absence of
credential-like literals (`potp_bb_`, PEM private-key headers, a non-`process.env` literal
`siteCredential`/`keyId` assignment) and of CleanDataPage/`aisummary`-route scaffolding in every
generated file; presence of the required environment-variable *names* (never a value); the
matcher-drift check against `@powerotp/gate-next`; package-version-vs-`package.json` drift;
absence of a fabricated `/_powerotp/webhooks/challenge-status` receiver in any generated file;
presence of the unresolved-verification-key and planned-webhook-secret disclosures in every
adapter's `knownLimitations`; and presence of the real rotation endpoint name in every adapter's
`placementSteps`.
`typecheck.test.ts` materializes each manifest's exact files at their exact relative paths under
a gitignored `backend/packages/mcp/.botblocker-typecheck/` scratch directory and shells out to this
monorepo's own `node_modules/typescript/bin/tsc` CLI — the classic embeddable
`ts.createProgram`/`ts.ModuleResolutionKind` compiler API does not exist in the native TypeScript
7 this repository already depends on, so the test spawns the same `tsc -p ... --noEmit` CLI every
workspace's own `typecheck` script already uses, rather than a different, less-representative
mechanism. All three adapters compile cleanly against the real, already-built
`@powerotp/gate-node`/`gate-express`/`gate-next` declaration files, which also independently
proves exact file placement and relative-import correctness (a wrong path or ordering would fail
module resolution, not just type-checking). `server-only` (added as an `backend/packages/mcp` `devDependency`
purely for this compile check, matching what a real Next.js customer installs) was empirically
confirmed to need no ambient type declaration for its side-effect-only `import "server-only";` form.

**Verification.** Focused suites: contracts (159 tests), gate-core (39), gate-node (21),
gate-express (22), gate-next (27 — this suite's own timing-sensitive fail-open/late-decision
timer tests were independently observed to intermittently fail and pass again on immediate
re-run twice during this phase, both before and after the credential-model correction; this is
pre-existing test flakiness in already-shipped Phase 13D code, not a regression from any Phase 14
change, and is unchanged by this phase), and mcp (41, up from an initial 32 after the
credential-model correction below). `npm run build -w @powerotp/mcp` and
`npm run typecheck -w @powerotp/mcp` passed. Full `npm run verify` (every workspace build, lint/
typecheck, and test, including the `@powerotp/gate-next` production fixture build already
performed as part of that build step) passed with zero failures across every reported suite, run
twice (once before and once after the credential-model correction). `npm audit` reported zero
vulnerabilities both times. Final `git diff --check` passed. A targeted scan of built
`backend/packages/mcp/dist/*.js` output found no `potp_bb_`, PEM private-key header, or
CleanDataPage/`aisummary` literal. A repository-wide scan of `frontend/.next` found `potp_bb_`
only in pre-existing, unrelated `backend/packages/api` server-only chunks (the site-credential prefix
constant, not a secret value, and absent from every `frontend/.next/static` client chunk) — this
predates Phase 14 and is not part of this phase's generated output.

**Exclusions and operations.** No real RapidAuth/intelligence ingestion, fingerprint/IP hash
derivation, scoring, production OTP orchestration, Passport/PaidTokenPass behavior, billing,
deployment, secrets, DNS, activation, policy publication, account management, repository
mutation, dashboard mutation, or hosting configuration was added or performed through MCP or
otherwise. No customer-hosted CleanDataPage route was created. No migration, seed, environment/
server configuration, remote mutation, commit, push, or deployment was performed.

## 2026-08-15 — BotBlocker Phase 15: real intelligence/event ingestion

> Historical implementation record: the matching, hashing, initial-event, cookie, token-refresh,
> and retention behavior below records what Phase 15 shipped. It is not the current target design.
> The authoritative corrections are summarized under **Current status** and specified in the
> Phase 17/17A plans; do not carry the old keyed-fingerprint/IP assumptions into later work.

**Outcome.** Implemented the authoritative MongoDB writer used by the existing
`POST /v1/botblocker/browser-assessment` and `POST /v1/botblocker/risk-events` central API
routes. Both routes retain the Phase 8 site-credential authentication, exact
runtime-origin/site/audience binding, Valkey idempotency/nonce claims, and IP/site rate limits.
After successful ingestion they still return the strict typed-unavailable response because
Phase 15 does not invent a score or decision; real `allow | otp` decisioning remains Phase
16/17/20. RapidAuth, challenge/OTP, Passport, PaidTokenPass, billing, and policy publication
remain unchanged.

**Production modules.**

- `backend/packages/contracts/src/botblocker.ts` adds document-normalized click positions and a
  strict optional `pageView` envelope: explicit page ID/name, interval active/total duration,
  document dimensions, sparse unique 32×32 pointer bins, and sanitized navigation target.
  `botblocker-persistence.ts` adds the server-derived page URL and an internal-only optional
  `passportUserId` reference for a later authoritative Passport binding; email/password fields
  are not part of intelligence storage.
- `libraries/gate-core/src/{sensor,sensor-evidence}.ts` now collects those analytics per
  five-second/30-second/partial interval. Pointer events are reduced in-browser to bounded bins;
  raw chronological movement is never emitted. Page labels come only from explicit
  `data-powerotp-page-id`/`data-powerotp-page-name` attributes, never `document.title` or DOM
  text.
- `backend/packages/api/src/botblocker-ingestion-service.ts` revalidates the strict behavior
  report/risk-event contracts, derives lookup hashes, opens a first report's visitor session,
  rejects future-dated/stale/cross-project input, and maps persistence failures to stable
  BotBlocker errors.
- `backend/packages/api/src/botblocker-session-persistence.ts` transactionally matches or creates
  project-scoped user intelligence and creates its gate session. Matching is limited to the
  approved preceding 30 days and requires both the server-derived fingerprint and keyed IP
  observation; an IP alone is never identity. A report without trusted IP context creates a
  separate profile rather than making a weak fingerprint-only merge.
- `backend/packages/api/src/botblocker-ingestion-persistence.ts` transactionally advances one
  strictly monotonic sequence stream per scoped gate session, writes immutable normalized
  behavior/risk-event rows, treats an exact replay as a duplicate, rejects a conflicting/equal/
  older sequence, and updates only the matching intelligence aggregate.
- `backend/packages/api/src/config.ts` adds the optional independent server-only
  `BOTBLOCKER_INTELLIGENCE_HASH_SECRET`. Ingestion fails with typed dependency-unavailable when
  it is absent; no fallback, unkeyed hash, or reused credential secret exists.
- `backend/apps/server/lib/{server-context,botblocker-http}.ts` constructs the real ingestion
  dependency and adds a shared authenticated mutation callback without duplicating Phase 8
  security. The browser-assessment and risk-events route handlers invoke it.
- `backend/packages/api/src/botblocker-intelligence-persistence.ts` exports its existing scope
  type for the new writer. `botblocker-operations-service.ts` reports
  `intelligence_ingestion` health from the independent secret.

**Data derivation, minimization, and retention.** Fingerprint and trusted-IP lookup values are
lowercase HMAC-SHA-256 hex derived only on the server. The fingerprint input is the already
strict sanitized evidence object; raw/browser-supplied fingerprint hashes are rejected. IP
input is accepted only by the server-side session seam, normalized, keyed, and never stored raw.
These hashes apply only to identity/network lookup keys, not generic page analytics; they are
computed once per relevant observation and queried through the existing indexes.
The durable writer accepts path-without-query/fragment; explicit page ID/name; page timing and
dimensions; click category/explicit `data-powerotp-id` plus normalized position; bounded
pointer-grid/mouse/scroll aggregates; honeypots; and fixed environment indicators. It derives
`pageUrl` from the authenticated audience origin plus sanitized route path, enabling a later
project heatmap viewer to open the page without trusting a browser-supplied URL. It stores no
query/fragment, clicked text, form value, raw absolute coordinate, chronological pointer trail,
document title, DOM/page content, email, or password.
Session/intelligence expiries refresh from server observation time; immutable report/event
expiries remain anchored to their occurrence time. All use the approved 548-day TTL schedule,
and matching uses the existing 30-day cutoff.

**Project scope and query behavior.** Authentication supplies customer/project/site scope; no
report claims ownership. Session lookup/creation, sequence advancement, event insert, aggregate
update, visitor listing, and report/event listing include the complete scope. A session ID from
another project neither authorizes access nor creates a replacement. Existing customer visitor
queries now include page-view count and total/active page-time aggregates while remaining
purpose-limited project summaries; stored sanitized reports
remain available through scoped persistence and the existing audited operator decision trace,
without exposing hashes or cross-tenant evidence.

**Tests.** Added `botblocker-ingestion-service.test.ts`,
`botblocker-ingestion-persistence.test.ts`, and `botblocker-session-persistence.test.ts`, and
updated configuration/health tests. Coverage includes exact replay idempotency, stale and
cross-project rejection, shared behavior/risk sequence ordering, strict prohibited-field
rejection before storage, deterministic keyed hash derivation/IP normalization, no IP-only
identity match, missing-secret typed unavailability, 30-day matching, and 548-day
session/intelligence/event retention. Corrective analytics tests additionally cover normalized
clicks, bounded/unique heatmap bins, pointer dwell aggregation, explicit page labels,
active/total timing, sanitized navigation targets, server-derived query-free page URLs,
project visitor timing aggregates, and exclusion of raw trails/content/authentication data.
Focused results after the correction: `@powerotp/contracts` 161 tests,
`@powerotp/gate-core` 40, and `@powerotp/gate-node` 21 passed; final API/backend/full-suite
counts are recorded by the closing verification below.
Full root `npm run verify` then passed every backend, frontend, library, application, and
integration build/lint/test with zero failures. `npm audit` at the root, backend, and frontend
lockfile boundaries each reported zero vulnerabilities. Final `git diff --check` passed.

**Documentation and controls.** Updated `THREAT_MODEL.md` with the implemented ingestion,
derivation, scope, idempotency/order, and retention controls. Updated only control-matrix rows
whose evidence changed (CC4, CC6.7, PI1, C1.1, A.5.15, A.5.34, and A.8.16); no control was
prematurely marked implemented. Phase 14 MCP content remains unchanged: its statement that
generated wrappers have no injected real `GateNodeServices` client is still true even though
the central ingestion routes now have real writers.

**Exclusions and operations.** No score, decision, rapid allowlist/blacklist, production OTP
orchestration, Passport/PaidTokenPass behavior, billing, deployment, DNS, secret value, policy
release, activation, customer-hosted CleanDataPage, fake development/production record, or
remote mutation was added or performed. No `.env` file was read or changed. No migration or
seed is required; existing startup index creation already owns the four BotBlocker collections.
The future heatmap overlay viewer/dashboard itself was not built in this ingestion phase. No
commit or push was performed.

**Post-phase architecture clarification (future work, not Phase 15 behavior).** The
`passportUserId` persistence-contract placeholder records that an intelligence profile may
eventually become associated with a user; Phase 15 does not populate it. The authoritative
future design will implement that association through dedicated MongoDB `identityBindings`
records so `userIntelligence` remains the primary behavior/risk profile while identity linkage
stays internal and auditable. Phase 21 must replace/retire the unpopulated direct placeholder
rather than write a raw Supabase user ID into intelligence. Supabase Enterprise will be the
ISO 27001-scoped account/identity
system of record for email, password/authentication hashes, verified attributes, and other PII;
MongoDB will retain intelligence plus only an opaque/keyed internal identity reference, never
those account fields or a customer-visible global user ID.

After scoring and Passport phases ship, every accepted session report will aggregate into its
`userIntelligence` profile and trigger server-side score recalculation. A changed score may
produce a newer signed `otp` recommendation at any time and suspend identity-bound Human
Passport or paid-agent fast access until authoritative recovery succeeds. Browser middleware
continues to observe and aggregate evidence only; it does not author scores, decisions, or
credential suspensions. These rules were added to the plan, threat model, and future phase
instructions to prevent later sessions from reviving the earlier ambiguous identity/scoring
interpretation.

## 2026-08-16 — BotBlocker Phase 8A corrective routing

**Outcome.** Completed the project-scoped runtime-routing correction. Every visitor runtime
route is nested under `[webhookId]`; public policy remains
`GET /v1/botblocker/policy/{siteId}`. The endpoint is an immutable
`bwh_<signed-payload>.<hmac>` token whose dedicated-secret HMAC binds version, random endpoint
ID, project ID, and site ID. Strict local syntax and constant-time HMAC validation return an
empty 404 before server-context loading, Valkey/rate limiting, MongoDB, body parsing,
authentication, replay handling, or business logic.

**Atomic provisioning.** Customer project creation pre-generates the project ID, project API
key, BotBlocker site ID, endpoint token, and independent webhook signing secret. One MongoDB
transaction inserts the project, API-key hash, site with encrypted signing secret, and
project/API-key/site audit records. Any write failure aborts all writes. The project-creation
and rapid-signup responses expose the safe site/endpoint configuration and show-once signing
secret; ordinary site reads never return the secret. Lazy site creation and cleanup-hook
pseudo-rollback were removed. No migration or backfill was needed or performed because there
are no production BotBlocker records.

**Runtime authorization and readiness.** Initial RapidAuth validates and resolves the endpoint,
checks project/site readiness, authenticates the site credential, opens the visitor session,
and returns a 30-minute HMAC token bound to project/site/session/audience. Every later runtime
operation uses that visitor token; a cross-project/site/session/audience token or credential is
rejected. Inactive sites return typed `offline` before body/authentication/ingestion. Gate Node
publishes pass-through full access, suppresses ordinary backend visitor calls, and performs
bounded readiness retries without overriding an active OTP. `offline` and `fail_open` are
lifecycle states; decisions remain exactly `allow | otp`, `openOtp()` remains argument-free,
and customer code retains rendering/enforcement control.

**Integration and documentation.** MCP environment output and Node/Express/Next templates now
require `POWEROTP_WEBHOOK_ID`, obtain endpoint/signing-secret setup from the project-creation
response, and emit no values. Architecture/data-boundary resources, manifest checks, API route
inventory, plan, development phases, threat model, control matrix, and App Platform variable
documentation were updated together. The corrected sensor analytics files from Phase 15 remain
present, including the updated gate-node `pageView` expectation.

**Verification actually performed.** Focused contracts, API, backend, MCP, gate-core, gate-node,
gate-express, and gate-next checks ultimately passed. The single `npm run verify` invocation
found a missing `webhookId` in the Express fixture; after that focused correction,
gate-express build/tests passed. The remaining root lint completed cleanly. Root tests then
identified the literal `visitorToken` in the Next client bundle (no credential value was
present); visitor-token claims were moved from shared contracts to the server-only API, after
which the gate-next production build and 27-test suite passed with the bundle scan clean.
Root, backend, and frontend `npm audit` each reported zero vulnerabilities. No claim is made
that the original `npm run verify` process itself exited successfully.

**Operations and exclusions.** This corrective working set was not committed or pushed by the
implementing agent. During verification, an external concurrent process created and pushed
`bcc71c8` from the earlier draft; the final corrections remain uncommitted on top of it. Nothing
was deployed, seeded, configured, migrated, or otherwise remotely mutated by this work. No
scoring, allow/blacklist behavior, Passport/PaidTokenPass behavior, billing, DNS, customer
activation, or later phase was implemented.

## 2026-08-16 — BotBlocker Phase 16 (partial): IP-hash reversal and dedicated IP blacklist

**Status: Phase 16 in progress, not complete.** This entry covers only steps 1–2 of the eight-step
execution breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md):
the IP-hash reversal and the dedicated `botblockerIpBlacklistV4`/`V6` tables with admin CRUD. The
remaining steps — ASN/subnet network ranges and MaxMind import, ASN classification and per-type
scoring, retiring the `botblockerRapidList` scaffold, the external IP-reputation API-lookup cache,
and wiring the two-branch decision into `rapidAuthMutation` — are **not implemented** and remain
future fresh-session work per that plan's own session-size discipline. `rapidAuthMutation` in
`backend/apps/server/lib/botblocker-http.ts` is unchanged and still returns the hardcoded
`{ status: "unavailable", reason: "not_implemented" }` decision.

**IP-hash reversal.** Per the plan's corrections section, raw IP storage replaces the Phase 15
`ipHash` field everywhere; only the fingerprint lookup remains a keyed HMAC-SHA-256 hash. This is
not treated as identity/PII because it is never linked to a Supabase account record, and the raw
value is needed for two documented purposes: showing it in a site owner's own visitor report, and
using it as a return-visit correlation signal.

- New `backend/packages/api/src/ip-utils.ts` extracts the previously-private `normalizeIp` (used
  only by the ingestion service) into a shared helper, plus a new `ipFamily` classifier, so the new
  IP blacklist persistence (below) derives the same canonical value instead of duplicating the
  logic.
- `botblocker-intelligence-persistence.ts`: `GateSessionDocument.ipHash` → `.ip`;
  `IpObservation.ipHash` → `.ip`; the `userIntelligence` compound indexes now key on
  `ipObservations.ip`.
- `botblocker-ingestion-service.ts`: removed the `#ipHash`/generic `#lookupHash(kind, value)`
  indirection; `#fingerprintHash` now hashes directly, and a new `#normalizedIp` validates without
  hashing. `startSession` passes the normalized raw IP straight through.
- `botblocker-session-persistence.ts`: matching/query/update all key on `ip` instead of `ipHash`;
  `updateIpObservations` is otherwise mechanically unchanged (still a non-unique, per-IP observation
  list, still never treating a repeated IP alone as identity).
- `botblocker-operations-service.ts`: the project-owned visitor summary now includes the visitor's
  raw `ip` (read directly from `ipObservations[0]`, not stored redundantly), while still excluding
  the fingerprint hash, raw events, and other tenants' data. Clarified after user review: a
  profile's `ipObservations` holds at most one entry today, because `openGateSession`'s matching
  rule only ever merges a new session into an *existing* profile when that session's IP is already
  one of the profile's observations, which then updates that same entry rather than adding a
  second one — there is no "earlier IP" to pick between yet, so the field is read plainly instead
  of via a most-recent-of-several computation that the matching rule never actually produces. The
  user separately confirmed the existing fingerprint-and-IP matching rule itself is unchanged and
  should stay exactly as designed for the no-cookie/no-Passport fallback case; a same-site return
  visit with an already-valid local clearance/cookie is a separate, already-implemented path
  (`openGateSession`'s exact-session-ID `existingById` branch) that updates the same linked
  `userIntelligence` row directly and never needed fuzzy matching in the first place.
- `backend/packages/contracts/src/botblocker-api-control.ts`'s `CustomerVisitorSchema` already had
  no IP field at all; added `ip: TrustedProxyIpSchema.optional()`.
- Found a **pre-existing uncommitted working-tree change**, not authored by this session, while
  doing this: at session start, `backend/packages/contracts/src/botblocker-persistence.ts`'s
  "record" contract schemas (`GateSessionRecordSchema`/`IpObservationSchema`) already had a raw
  `ip` field (`git show HEAD:...` confirms the committed version at `0f00c08` still says `ipHash`/
  `ServerIpHashSchema` — this session never edited this file directly, so the working-tree
  difference predates it). That stray, partial, contracts-only edit left `botblocker-persistence
  .test.ts`'s fixtures — which still passed `ipHash` — failing against the now-`.strict()`-mismatched
  schema. Verified with a baseline test run before making any change of my own (3 pre-existing
  failures in that one file). This session's IP-hash reversal supersedes and completes that
  stray edit consistently across the real implementation, so the fix is to update the test
  fixtures to `ip` to match the schema that was already there. Flagging this because it means the
  actual pre-session working tree was not fully clean/uncoded relative to this plan, despite the
  plan document's "no code in this repository has been changed" framing — worth the user's
  awareness, not a criticism of this session's own work.
- `config.ts`'s `BOTBLOCKER_INTELLIGENCE_HASH_SECRET` doc comment, `docs/THREAT_MODEL.md`'s
  BotBlocker ingestion section, and `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`'s
  `C1.1` and `A.5.34` rows were corrected to state raw IP retention plainly instead of claiming IP
  hashing or "raw IP addresses are not durable fields."
- No migration was needed or performed (zero production BotBlocker records, per the standing
  project rule).

**Dedicated IP blacklist (fast-immediate branch, steps 2 of the plan).** New
`backend/packages/api/src/botblocker-ip-blacklist-persistence.ts` implements
`botblockerIpBlacklistV4`/`V6` exactly as designed: physically separate per-family collections,
each with fields `_id`, `ip` (raw, exact, unique-indexed), `reason`, `provenance`
(`operator_manual` | `automatic_detection`), optional `expiresAt`/`revokedAt`, `createdBy`,
`createdAt`, `updatedAt`. Every entry ID is prefixed by its family (`bl4_…`/`bl6_…`,
`identifyBlacklistEntryFamily`) so a caller holding only an `entryId` (e.g. a revoke request) can
address the correct physical collection without an extra round trip or a redundant family
parameter. `upsertEntry` is a refresh-in-place upsert keyed on the normalized IP (not a
duplicate-rejecting insert): re-adding an already-blacklisted or previously-revoked IP overwrites
its reason/provenance/expiry and clears any prior revocation, since the unique index enforces one
row per raw IP — this is documented on `OperatorIpBlacklistMutationSchema` so a future caller does
not "fix" it into an error path. `revokeEntry`, `findByIp`, and `listEntries` (paginated,
`createdAt`-descending, per family) round out the persistence surface; none of it is wired into
`rapidAuthMutation` yet (that is step 7, later).

**Admin CRUD routes.** Two new operator-only routes under `/v1/control/botblocker/*`, following the
exact `requireAdminSession`/CSRF/`Idempotency-Key`/`enforceRateLimit`/`cache-control: no-store`
pattern already used by `policy-releases` and `rapid-list`:

- `GET, POST /v1/control/botblocker/ip-blacklist` — list (requires a `family` query param; no
  cross-family merge, matching the plan's "physically separate per family" model even for
  admin-facing reads) and create/refresh.
- `POST /v1/control/botblocker/ip-blacklist/revoke` — revoke by `entryId` alone (family is decoded
  from the ID prefix, not accepted as a separate body field).

Both routes share one mapping function, `toIpBlacklistEntryResponse` (exported from the persistence
module), so the list/create and revoke responses cannot drift from each other.

**Contracts.** Added to `backend/packages/contracts/src/botblocker-api-control.ts`:
`BotBlockerIpFamilySchema` (`v4`/`v6`), `IpBlacklistProvenanceSchema`,
`OperatorIpBlacklistMutationSchema`, `OperatorIpBlacklistEntrySchema`,
`OperatorIpBlacklistMutationResponseSchema`, `OperatorIpBlacklistQuerySchema`,
`OperatorIpBlacklistListResponseSchema`, `OperatorIpBlacklistRevokeRequestSchema`, and matching
inferred types. Added `unknown_entry` to `botblocker.ts`'s `botBlockerErrorCodes` for an
operator-referenced record (e.g. a revoke target) that does not exist. The pre-existing
`botblockerRapidList` scaffold (`OperatorRapidListMutationSchema`, `rapidListIndicatorKinds`, the
`/v1/control/botblocker/rapid-list` route) is **untouched** — its removal is plan step 5, not part
of this session's scope.

**Wiring.** `backend/packages/api/src/persistence.ts` registers
`ensureBotBlockerIpBlacklistIndexes` (unique `ip` index plus a `createdAt` index, per family) in the
existing isolated `ensureIndexStep` startup sequence. `backend/apps/server/lib/server-context.ts`
constructs one `BotBlockerIpBlacklistPersistence(dataStores.db)` and exposes it on `ServerContext`
as `botBlockerIpBlacklist`, alongside the existing BotBlocker services.

**Tests.** New `botblocker-ip-blacklist-persistence.test.ts` covers family-prefixed ID generation,
v4/v6 collection separation, refresh-in-place upsert semantics (including clearing a prior
revocation and expiry), invalid-IP rejection (`IpBlacklistValidationError`), revoke-by-ID including
unknown/wrong-prefix IDs, `findByIp` normalization across families, per-family paginated listing,
and the shared response-mapping helper. Updated
`backend/packages/contracts/src/botblocker-api-control.test.ts` with new `describe` coverage for
every new schema (valid v4/v6 mutations, malformed-IP rejection, forbidden caller-supplied identity/
score fields, the required `family` list-query param, and a bare-`entryId` revoke request). Fixed
the six pre-existing `ipHash`-referencing test files identified above
(`botblocker-ingestion-service.test.ts`, `botblocker-session-persistence.test.ts`,
`botblocker-intelligence-persistence.test.ts`, `botblocker-operations-service.test.ts`,
`botblocker-api-control.test.ts`, `botblocker-persistence.test.ts`) to use raw `ip` fixtures instead
of `ipHash`.

**Verification.** Focused suites run directly (this Windows/PowerShell environment's `npm run test`
invocations fail on every workspace's `"src/**/*.test.ts"` script glob — a pre-existing, unrelated
issue affecting the whole monorepo identically, not something this session introduced or fixed;
worked around here by enumerating files explicitly): `@powerotp/contracts` 167/167,
`@powerotp/api` 239/239, and `@powerotp/backend`'s explicit test list (route-inventory,
BotBlocker Phase 8 HTTP, policy-route, and `lib/**` suites) 15/15, all zero failures.
`tsc --noEmit`/`tsc -p tsconfig.json --noEmit` passed cleanly for `@powerotp/contracts`,
`@powerotp/api`, and `@powerotp/backend`. A full `npm run verify` was then run once: the `build`
stage succeeded completely, including the production Next.js build of `@powerotp/backend`, whose
printed route table confirms both new routes
(`/v1/control/botblocker/ip-blacklist`, `/v1/control/botblocker/ip-blacklist/revoke`) compiled and
registered correctly; the `lint` stage (`tsc --noEmit` across every workspace) passed completely;
the `test` stage failed, but only because of the same pre-existing Windows glob issue described
above, reproduced identically across every workspace's test script including ones this session
never touched (`@powerotp/botblocker-signing`, `@powerotp/mcp`) — not a regression from this
session's changes. `backend/apps/server/app/route-inventory.test.ts`'s drift check (part of the
15/15 above) independently confirms the two new route files' paths and exported HTTP methods match
the `docs/API_ROUTE_INVENTORY.md` rows added for them exactly.

**Documentation.** Added the two new routes to `docs/API_ROUTE_INVENTORY.md` in their existing
`/v1/control/botblocker/*` block.

**Exclusions and operations.** No ASN/subnet network-range tables, MaxMind import pipeline, ASN
classification/type-score tables or admin routes, external IP-reputation API-lookup cache, seeded
placeholder row, or `rapidAuthMutation` wiring were added — all remain later steps of this same
Phase 16 plan. No scoring, Passport/PaidTokenPass behavior, billing, deployment, DNS, or customer
activation was touched. No `.env` file was read or changed. No migration or seed was performed. No
commit or push was performed; git status was left for the user to review.

## 2026-08-17 — BotBlocker Phase 16 (partial): network ranges, ASN classification, and type scores

**Status: Phase 16 in progress, not complete.** This entry covers steps 3–4 of the eight-step
execution breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md):
the `botblockerNetworkRangesV4`/`V6` collection shape/indexes plus their synchronous indexed range
lookup, and the `botblockerAsnClassifications`/`botblockerAsnTypeScores` tables with admin CRUD
routes. Steps 1–2 (IP-hash reversal, dedicated IP blacklist) shipped in the prior session (commit
`74ad253`, see the dated entry directly above). Steps 5–8 — retiring the `botblockerRapidList`
scaffold, the external IP-reputation API-lookup cache, wiring the two-branch decision into
`rapidAuthMutation`, and closing documentation — are **not implemented** and remain future
fresh-session work per the plan's own session-size discipline. `rapidAuthMutation` in
`backend/apps/server/lib/botblocker-http.ts` is unchanged and still returns the hardcoded
`{ status: "unavailable", reason: "not_implemented" }` decision; none of this session's new
persistence classes are called from any runtime route yet.

**Network ranges (fast-immediate branch, step 3).** New
`backend/packages/api/src/botblocker-network-range-persistence.ts` implements
`botblockerNetworkRangesV4`/`V6` exactly as designed: physically separate per-family collections
of flat, non-overlapping CIDR-range partitions, each row carrying `_id`, `cidr`, `prefixLength`,
`asn`, `asnOrg`, `sourceDataset`, `importBatchId`, `importedAt`, plus family-specific bounds —
`rangeStart`/`rangeEnd` (plain unsigned 32-bit integers) for v4, `rangeStartHex`/`rangeEndHex`
(fixed-width 32-character zero-padded lowercase hex) for v6. Per the plan's item 9 correction there
is **no import pipeline** in this repository; the user loads each MaxMind GeoLite2-ASN CSV into
MongoDB manually. `ensureBotBlockerNetworkRangeIndexes` creates the single supporting B-tree index
per collection (`{ rangeStart: 1 }` / `{ rangeStartHex: 1 }`). `BotBlockerNetworkRangePersistence
#lookupByIp` implements the actual synchronous range lookup the plan calls for — "greatest
start <= ip, confirm ip <= end," the same flat-file technique MaxMind/IPinfo's own products use —
but it is not called from any route in this session; a later step (7) wires it into the
fast-immediate branch.

`backend/packages/api/src/ip-utils.ts` gained the encoding primitives the lookup needs, reused
rather than duplicated per the reference pattern: `ipv4ToUint32` (multiplication, not bit-shifting,
since a left-shifted top octet overflows JS's signed 32-bit bitwise operand range while the full
unsigned result fits `Number.MAX_SAFE_INTEGER`), `ipv6ToFixedWidthHex` (expands `::` compression and
any embedded IPv4 tail, e.g. `64:ff9a::192.0.2.1`, into the full eight 16-bit groups without a new
library dependency or a BigInt round trip — validated per-group against a hex pattern so malformed
input like a stray triple colon is rejected rather than silently zero-filled), and
`encodeIpForRangeLookup` (normalize + classify + encode in one call, the single entry point both
this module's lookup and any future caller should use).

**ASN classification and type scores (fast-immediate branch, step 4).** New
`backend/packages/api/src/botblocker-asn-classification-persistence.ts` implements
`botblockerAsnClassifications`: one row per unique ASN, keyed by the bare ASN number as MaxMind's
own CSV provides it (e.g. `64500`, not `AS64500`) so a manually-loaded network-range row's `asn`
field joins directly against this collection's `_id` with no format-translation step. Fields:
`_id` (=asn), optional `asnOrg`/`notes`, `asnType` (`datacenter` | `residential_isp` |
`isp_static` | `known_proxy` | `unclassified`), `classificationSource` (`ai_research` | `manual` |
`heuristic`), `createdAt`, `updatedAt`, `updatedBy`. `upsertClassification` refreshes an existing
row for the same ASN in place (matching the ip-blacklist upsert pattern — "one row per unique ASN"
is naturally idempotent, not a duplicate-rejecting insert); `listClassifications` supports an
optional `asnType` filter with `updatedAt`-descending cursor pagination.

New `backend/packages/api/src/botblocker-asn-type-score-persistence.ts` implements
`botblockerAsnTypeScores`: at most five rows total, one per `AsnType`, each `_id: asnType`,
`score` (admin-entered integer, starts `0`/neutral), `requiresApiLookup` (starts `false`),
`updatedAt`, `updatedBy` — never a fabricated "real" risk number. `ensureBotBlockerAsnTypeScoreIndexes`
is an intentional no-op (documented inline): `_id` already covers exact-match lookup and the
collection is capped at five rows, so no index beyond MongoDB's own default is needed; the export
exists only to match the `ensureBotBlocker*Indexes` registration convention every other collection
follows. `listAllScores` always returns exactly one entry per `AsnType`, synthesizing an
unpersisted `{ score: 0, requiresApiLookup: false }` default for any type an admin has not yet
configured, so the admin page's "number entry for each ASN type" (the user's own description) is
always fully populated without a separate seed step.

**Contracts.** Added to `backend/packages/contracts/src/botblocker-api-control.ts`: `asnTypes`/
`AsnTypeSchema`, `asnClassificationSources`/`AsnClassificationSourceSchema`, `AsnNumberSchema`,
`OperatorAsnClassificationMutationSchema`, `OperatorAsnClassificationEntrySchema` (and its
mutation-response/query/list-response siblings), `OperatorAsnTypeScoreMutationSchema`,
`OperatorAsnTypeScoreEntrySchema` (and its mutation-response/list-response siblings, the list
response fixed at exactly `asnTypes.length` entries), plus matching inferred types. No new
`botBlockerErrorCodes` entry was needed — both mutation routes are upserts (create-or-update, like
the IP blacklist), so there is no "unknown entry" 404 case to add.

**Admin routes.** Two new operator-only routes under `/v1/control/botblocker/*`, following the
exact `requireAdminSession`/CSRF/`Idempotency-Key`/`enforceRateLimit`/`cache-control: no-store`
pattern already used by `ip-blacklist`:

- `GET, POST /v1/control/botblocker/asn-classifications` — list (optional `asnType` filter,
  cursor-paginated) and create/refresh a classification.
- `GET, POST /v1/control/botblocker/asn-type-scores` — list always returns exactly five entries
  (real or synthesized defaults, no pagination since the set is fixed); `POST` upserts a single
  type's score/`requiresApiLookup`.

**Wiring.** `backend/packages/api/src/persistence.ts` registers `ensureBotBlockerNetworkRangeIndexes`,
`ensureBotBlockerAsnClassificationIndexes`, and `ensureBotBlockerAsnTypeScoreIndexes` in the
existing isolated `ensureIndexStep` startup sequence. `backend/apps/server/lib/server-context.ts`
constructs one `BotBlockerNetworkRangePersistence`, `BotBlockerAsnClassificationPersistence`, and
`BotBlockerAsnTypeScorePersistence` (all keyed off `dataStores.db`) and exposes them on
`ServerContext` as `botBlockerNetworkRanges`, `botBlockerAsnClassifications`, and
`botBlockerAsnTypeScores`, alongside the existing BotBlocker services.

**Tests.** New `ip-utils.test.ts` (this collection's underlying primitives had no dedicated test
file before this session) covers `normalizeIp`/`ipFamily` plus the new `ipv4ToUint32`/
`ipv6ToFixedWidthHex`/`encodeIpForRangeLookup`: address-space corners, `::` compression at the
start/middle/end, an embedded IPv4 tail, lexicographic-matches-numeric ordering, and malformed-input
rejection (including a stray triple colon). New `botblocker-network-range-persistence.test.ts`
covers index creation, a v4 lookup bracketed inside/just-outside a range, picking the correct
partition among several non-overlapping v4 ranges, a v6 lookup via the fixed-width hex encoding, and
an invalid IP or empty dataset returning `undefined`. New `botblocker-asn-classification-persistence
.test.ts` and `botblocker-asn-type-score-persistence.test.ts` cover upsert-refresh-in-place
semantics, filtered/paginated listing, the default-synthesis behavior for unconfigured types, and
both response-mapping helpers' optional-field handling. Updated
`backend/packages/contracts/src/botblocker-api-control.test.ts` with new `describe` coverage for
every new schema (valid/invalid ASN and type values, forbidden caller-supplied identity/timestamp
fields, the optional `asnType` list-query filter, and both entry schemas' persisted-vs-default
optionality).

**Verification.** Focused suites run directly with this machine's Node 22.23.2 (matching `.nvmrc`,
resolving the prior session's Windows glob issue): `@powerotp/contracts` 175/175 (up from 167),
`@powerotp/api` 275/275 (up from 239), both zero failures. `tsc -p tsconfig.json --noEmit` passed
cleanly for `@powerotp/contracts` and `@powerotp/api`.

An initial focused `@powerotp/backend` run (14/15, with `route-inventory.test.ts` failing) and a
first full `npm run verify` (failed at the very first build step, before reaching lint or test)
were both traced to a set of stray, untracked, pre-Phase-8A route files sitting in the working tree
(old unscoped `app/v1/botblocker/*/route.ts` paths without the `[webhookId]` segment, e.g.
`app/v1/botblocker/rapid-auth/route.ts` alongside the real, current
`app/v1/botblocker/rapid-auth/[webhookId]/route.ts`). These were investigated properly rather than
left as an assumed pre-existing caveat: `git log --diff-filter=D` on several of them showed they had
already been deleted from git history by the real Phase 8A corrective-routing commit; the ones with
no such history were confirmed byte-for-byte duplicates of already-tracked files (e.g. a
`policy/[siteId]/route.test.ts` identical to the tracked `policy-route.test.ts`); and every route
file's content called a stale `unavailableRuntimeMutation`-family helper signature with fewer
arguments than the current implementation accepts — all independently confirming these were dead,
already-superseded code, not live work. All eleven stray files were deleted for real this run
(`app/v1/botblocker/{agent/entitlements,browser-assessment,challenges,challenges/[challengeId],
challenges/[challengeId]/complete,paid-passes/assert,passports/assert,passports/register,
rapid-auth,risk-events}/route.ts` and `app/v1/botblocker/policy/[siteId]/route.test.ts`), which
immediately fixed `route-inventory.test.ts` (`@powerotp/backend` focused suite: **15/15**) and the
`tsc --noEmit` errors that had been isolated to those same files.

A second full `npm run verify` attempt then failed differently: `next build`'s Turbopack bundler
failed to resolve `@aws-sdk/client-s3`, `@modelcontextprotocol/server`, `bullmq`, `ioredis`, and
`libphonenumber-js` from `node_modules`, each with Windows error `os error 389` ("the cloud
operation was unsuccessful") — a Windows CloudFilter API failure, not a missing-dependency problem.
Root cause: this entire repository (including `node_modules`) lived inside
`C:\Users\erics\OneDrive\...`, and OneDrive's Files-On-Demand feature had turned those specific
package files into cloud-only placeholders it failed to hydrate fast enough under Turbopack's
concurrent build-time file reads. This reproduced identically on a second independent attempt (not
a one-off transient blip), and is the same class of interference responsible for the stray files
above — OneDrive's own local sync/versioning engine silently resurrecting files a real git commit
had already deleted, and here dehydrating live dependency files mid-build. `git fsck --full` was
run to rule out actual repository corruption: **clean** (only 3 harmless dangling blobs, normal
history garbage; HEAD and full reflog were intact and linear).

**Resolution: relocated the entire working copy out of OneDrive.** Copied the repository (excluding
regenerable `.gitignore`-listed directories — `node_modules/`, `.next/`, `dist/`, `coverage/`,
`.botblocker-typecheck/`) from `C:\Users\erics\OneDrive\Documents\GitHub\POWEROTP` to
`C:\local only folder\POWEROTP` (a plain local, non-cloud-synced path already used for other
local-only projects on this machine), verified `git status`/`git log` matched exactly at the new
location, ran a fresh `npm install` at all three independent workspace roots (repo root, `backend/`,
`frontend/`), and moved this session's workspace root there via the `move_agent_to_root` tool.
**The prior OneDrive location (`C:\Users\erics\OneDrive\Documents\GitHub\POWEROTP`) is now stale and
should not be used for future sessions or local development on this machine** — the copy at
`C:\local only folder\POWEROTP` is the current one. That migration tool's own internal branch
reconciliation created an unrequested `git commit` ("checkpoint before checking out main") that
swept up this session's uncommitted work plus an unrelated stray `instrumentation.ts` file sitting
under a legacy pre-separation top-level app directory (not part of any current workspace) and a
`package-lock.json` diff; per the standing "never commit without explicit instruction" rule,
this was caught and undone immediately with `git reset HEAD~1`, restoring the exact same
modified/untracked working-tree state that existed beforehand (confirmed by diffing `git status`
before and after).

With the repository fully off OneDrive, `npm run build:backend` (the same command that failed
twice before) now completes cleanly: Turbopack compiles successfully, TypeScript passes, all 44
routes generate, and the printed route table shows both new routes
(`/v1/control/botblocker/asn-classifications`, `/v1/control/botblocker/asn-type-scores`) registered
correctly alongside every `[webhookId]`-nested BotBlocker route with no ambiguity. A full
`npm run verify` (build + lint + test, every workspace) then passed **with zero failures across
every reported suite** — contracts 175/175, api 275/275, backend 15/15, and every other workspace
(gate-core, gate-node, gate-express, gate-next, mcp, botblocker-signing, frontend, integration-tests,
etc.) green. The one incidental `package-lock.json` diff from the fresh install
(`@typescript/typescript-linux-x64` dropped from the root optional-dependency resolution) is
expected, correct behavior — that package is a Linux-only native TypeScript binary that a Windows
`npm install` correctly does not resolve; it was left in place rather than reverted, since reverting
would just make the lockfile inaccurate for this platform again.

**Documentation.** Added the two new routes to `docs/API_ROUTE_INVENTORY.md` in their existing
`/v1/control/botblocker/*` block (alphabetically before `decision-traces`). Updated
`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`'s execution breakdown to mark steps 3–4
complete with a link to this entry.

**Exclusions and operations.** No MaxMind import pipeline, `botblockerRapidList` scaffold removal,
external IP-reputation API-lookup cache/seeded row, or `rapidAuthMutation` wiring were added — all
remain later steps of this same Phase 16 plan (5–7 per the plan's breakdown). No scoring,
allow/blacklist decisioning, Passport/PaidTokenPass behavior, billing, deployment, DNS, or customer
activation was touched. No `.env` file was read or changed (none exist locally on this machine — all
real secrets live on the DigitalOcean droplet/App Platform config, per the standing project rule).
No migration or seed was performed (zero production BotBlocker records, per the standing project
rule — also moot here since these are new, previously nonexistent collections). The eleven
pre-existing stray OneDrive-artifact route/test files described above **were deleted** after being
independently confirmed dead (git-history-deleted, byte-identical duplicate, or stale-signature
code) — this is the one exception to this session's "stay within steps 3-4" scope, done at the
user's explicit direction after they questioned why it was left as a caveat instead of fixed. The
whole repository was also relocated from OneDrive to `C:\local only folder\POWEROTP`, at the user's
explicit direction, after `os error 389` Turbopack build failures traced to OneDrive Files-On-Demand
dehydrating `node_modules` files mid-build. No commit or push was performed: an unrequested
auto-checkpoint commit created by the workspace-root-move tool was caught and reverted
(`git reset HEAD~1`) so the working tree ended in the same uncommitted state it was in before the
move; git status was left for the user to review.

## 2026-08-17 — BotBlocker Phase 16 (partial): retire the `botblockerRapidList` scaffold

**Status: Phase 16 in progress, not complete.** This entry covers step 5 of the eight-step
execution breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md):
full removal of the pre-existing `botblockerRapidList` scaffold. Steps 1–4 (IP-hash reversal,
dedicated IP blacklist, network ranges, ASN classification/type scores) shipped in the two prior
sessions (commit `74ad253`, and the uncommitted working-tree changes from the immediately preceding
session — see the two dated entries directly above). Steps 6–8 — the external IP-reputation
API-lookup cache, wiring the two-branch decision into `rapidAuthMutation`, and closing
documentation — are **not implemented** and remain future fresh-session work per the plan's own
session-size discipline. `rapidAuthMutation` in `backend/apps/server/lib/botblocker-http.ts` is
unchanged and still returns the hardcoded `{ status: "unavailable", reason: "not_implemented" }`
decision.

**What was removed.** Per the plan's corrections section (item 2) and its "Retiring the existing
`botblockerRapidList` scaffold entirely" section: there is no admin-managed "override" list — the
only admin-facing configuration is the ASN-type score table already shipped in steps 3–4. This
session deleted, rather than narrowed or renamed, every piece of the scaffold:

- `backend/packages/contracts/src/botblocker-api-control.ts`: removed `rapidListKinds`,
  `RapidListKindSchema`, `rapidListIndicatorKinds`, `RapidListIndicatorKindSchema`,
  `OperatorRapidListMutationSchema`, `OperatorRapidListQuerySchema`,
  `OperatorRapidListEntrySchema`, `OperatorRapidListResponseSchema`, and the inferred types
  `RapidListKind`, `RapidListIndicatorKind`, `OperatorRapidListMutation`,
  `OperatorRapidListQuery`, `OperatorRapidListEntry`. (`OperatorRapidListResponseSchema` had no
  corresponding inferred type export to begin with.)
- `backend/packages/contracts/src/botblocker-api-control.test.ts`: removed the
  `OperatorRapidListMutationSchema` import and its two `describe("operator contracts")` cases
  (`"accepts rapid-list input without caller authority"`,
  `"rejects caller signatures, scores, weights, ownership, and success"`); the remaining cases in
  that `describe` block (decision traces, operator health, policy publication) are unaffected.
- `backend/apps/server/app/v1/control/botblocker/rapid-list/route.ts` and its containing
  `rapid-list/` directory: deleted entirely (previously a stub returning `not_implemented` for
  both `GET` and `POST`).
- `docs/API_ROUTE_INVENTORY.md`: removed the `rapid-list` row from the
  `/v1/control/botblocker/*` block.

Before deleting, confirmed via a repo-wide search (excluding `node_modules`) that
`OperatorRapidListMutationSchema`, `rapidListIndicatorKinds`, `RapidListKindSchema`,
`RapidListIndicatorKindSchema`, and `rapid-list` had no other referrers anywhere in `backend/` —
the three files above were the only ones touching the scaffold, exactly matching the plan's
removal list. The only remaining hits after removal are historical/narrative mentions in this
document, the Phase 16 plan itself, `POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`'s Phase 8 charter
list, and `POWEROTP_BOTBLOCKER_PLAN.md` — none of those are code and none were changed, since they
describe past design/charter history rather than a live reference to the removed exports.

**Verification.** `@powerotp/contracts`: rebuilt (`tsc -p tsconfig.json`) cleanly; focused run of
`botblocker-api-control.test.ts` (`node --import tsx --test`) passed 18/18; full workspace test
suite passed 173/173 (down from 175/175 in the prior entry, matching the two removed cases exactly,
zero failures); `tsc -p tsconfig.typecheck.json` passed cleanly. `@powerotp/api` was unaffected by
this step (no references to the scaffold existed there) but was rebuilt anyway
(`tsc -p tsconfig.json`, run directly in that package since it is not a root npm workspace) so
`@powerotp/backend` could resolve both packages' rebuilt `dist/` output.
`@powerotp/backend`: after clearing a stale `.next/` directory (its generated
`.next/types/validator.ts` still imported the just-deleted route file, which is expected — Next.js
regenerates this file from the current route tree on the next build/typecheck, this is not a code
defect), `tsc --noEmit` passed with zero errors and the focused test list
(`app/health/route.test.ts`, `app/route-inventory.test.ts`,
`app/v1/botblocker/phase8-http.test.ts`, `app/v1/botblocker/policy-route.test.ts`,
`lib/**/*.test.ts`) passed 15/15 — including `route-inventory.test.ts`, which failed in the prior
session's entry solely because of stray unscoped `app/v1/botblocker/*/route.ts` OneDrive-sync
artifacts flagged in that entry; this session confirmed those stray files are no longer present in
this working tree (resolved outside this session, as expected, since the prior entry described it
as a human housekeeping action), so that pre-existing failure is gone on its own.

A full `npm run verify` was attempted once per the project's own discipline; the `build` stage
failed, but for a reason unrelated to this session's change and unrelated to the previously-flagged
stray-route-file issue: Turbopack's production build repeatedly hit
`Error: Module not found` for several third-party dependencies that are demonstrably present in
`node_modules` (`bullmq`, `mongodb`, `ioredis`, `@aws-sdk/client-s3`,
`@modelcontextprotocol/server`, `libphonenumber-js`), each accompanied by
`Caused by: - The cloud operation was unsuccessful. (os error 389)` — a Windows/OneDrive
Files-On-Demand cloud-placeholder I/O error, not a missing dependency (confirmed `Test-Path` true
for all of them; a directory listing of one, `node_modules/bullmq`, returned no materialized
children, consistent with an un-hydrated cloud placeholder). None of the failing modules
(spaces-client, alert-worker, billing-daily-charge-worker, callback-worker,
provider-reconcile-worker, verification-queue, dependencies, country-lookup) have any relationship
to the `botblockerRapidList` scaffold removed this session. Retried the build once more (it ran
over three minutes, longer than the first attempt, consistent with OneDrive re-hydrating
placeholders) and it failed identically. This is a new manifestation of the same general "this
machine's OneDrive-synced working tree interferes with Next.js/Turbopack builds" environment
category the immediately preceding session's entry already flagged (there, ambiguous stray route
files; here, un-hydrated cloud file placeholders for unrelated dependencies) — not a regression
from this session's change, and not something to fix as part of BotBlocker work; it needs a human
to either disable OneDrive Files-On-Demand for this folder or force a full local hydration
(e.g. `attrib -U` a targeted rehydration, or right-click "Always keep on this device" on the repo
folder) before `npm run verify`'s build/lint/test chain can run to completion on this machine.

**Correction: steps 3–4 were already committed and pushed before this session started.** This
session's own handoff prompt (from the immediately preceding session) stated steps 3–4 were
uncommitted, and this session's local OneDrive checkout's `git status` agreed (`up to date with
origin/main` at `74ad253`) — but that was a stale local remote-tracking ref, not reality: the
preceding session had in fact already committed and pushed that work (`899facf`) from a different
local checkout (`C:\local only folder\POWEROTP`) before this session began, and its own as-built
entry recorded that push. `git push` at the end of this session was rejected for exactly that
reason (`origin/main` had a commit this checkout hadn't fetched), which is what surfaced the stale
handoff. **This is a recurring class of mistake: writing an as-built entry/handoff describing
"not committed/pushed" and then a commit+push actually happens afterward (by the same session,
a follow-up action, or the user) without the written record being corrected** — a future session
then inherits stale instructions and risks redoing or re-diverging from already-shipped work
exactly as happened here. The fix applied going forward: **push first, then write the as-built
entry and next-session handoff last**, so the written record always reflects the true final state
rather than a snapshot from before the last push.

Once the stale-fetch state was discovered, `git fetch origin` confirmed `899facf` (steps 3–4,
already shipped, containing files byte-identical to this session's own independently-produced
copies of the same files) and `git rebase origin/main` replayed this session's step-5-only delta
on top of it cleanly (all steps 3–4 files matched with zero diff; only this session's unique
changes — `backend/packages/contracts/src/botblocker-api-control.ts` and `.test.ts`, this document,
and the plan document — needed manual conflict resolution, done by hand). The result is a clean,
linear history: `74ad253` → `899facf` (steps 3–4) → `f423cc7` (step 5 only), matching the plan's
own step boundaries with no duplicated or redundant content.

`899facf`'s own as-built entry (directly above this one) also separately records that the preceding
session relocated the repository to `C:\local only folder\POWEROTP` after tracing the `os error 389`
Turbopack failures (same class this session's own Verification section above independently
rediscovered) to OneDrive Files-On-Demand, and flagged the OneDrive path as stale for future local
development. That relocation is real and already reflected in `899facf`'s history; it is unrelated
to the stale-handoff issue corrected in this paragraph, which was purely about the written
commit/push status of steps 3–4, not about which local path is preferred.

**Documentation.** Updated `POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`'s execution
breakdown to mark step 5 complete with a link to this entry.

**Exclusions and operations.** No external IP-reputation API-lookup cache, seeded placeholder row,
or `rapidAuthMutation` wiring were added — both remain later steps of this same Phase 16 plan (6–7
per the plan's breakdown). No scoring, allow/blacklist decisioning, Passport/PaidTokenPass
behavior, billing, deployment, DNS, or customer activation was touched. No `.env` file was read or
changed. No migration or seed was performed. **This session's commit was pushed to `origin/main`
as `f423cc7`** (steps 3–4 were already pushed as `899facf` before this session started; this
session added only the step-5 delta on top, per the correction above).

## 2026-08-17 — BotBlocker Phase 16 (partial): external IP-reputation vendor cache

**Status: Phase 16 in progress, not complete.** This entry covers step 6 of the eight-step
execution breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md):
the `botblockerIpApiLookupsV4`/`V6` external vendor cache, its seeded placeholder row, and a
composed-but-unwired awaited-lookup service. Steps 1–5 (IP-hash reversal, dedicated IP blacklist,
network ranges, ASN classification/type scores, retiring the `botblockerRapidList` scaffold)
shipped in the three prior sessions (commits `74ad253`, `899facf`, `f423cc7`). Steps 7–8 — wiring
the two-branch decision into `rapidAuthMutation` and the closing documentation pass — are **not
implemented** and remain future fresh-session work. `rapidAuthMutation` in
`backend/apps/server/lib/botblocker-http.ts` is unchanged and still returns the hardcoded
`{ status: "unavailable", reason: "not_implemented" }` decision; none of this session's new
classes are called from any runtime route yet.

**Cache persistence.** New `backend/packages/api/src/botblocker-ip-api-lookup-persistence.ts`
implements `botblockerIpApiLookupsV4`/`V6` exactly as the plan's section 5 specifies: `_id`, `ip`
(raw), `vendor` (a plain configured string label, never a hardcoded provider name — the user
mentioned one informally as "ip.fino," likely a mishearing, per the plan's own caveat),
`score`, `rawResponse` (stored as-received, unshaped), `queriedAt`, `expiresAt`. Family split and
ID-prefix convention (`ipl4_`/`ipl6_`) match the shipped `botblockerIpBlacklistV4`/`V6` exactly.
`ensureBotBlockerIpApiLookupIndexes` creates a unique `{ ip: 1 }` index plus a TTL index on
`{ expiresAt: 1 }` (`expireAfterSeconds: 0`) per collection, then seeds the placeholder row.
`BotBlockerIpApiLookupPersistence#findByIp` is the cache-check step the wait-for-full-result branch
will run before ever calling the live vendor API (returns the row's own `expiresAt` rather than
filtering expired rows out itself, so a future caller can distinguish "no row" from "expired row"
if that ever matters); `#upsertEntry` refreshes an existing row for the same IP in place, matching
the ip-blacklist/network-range upsert-refresh convention rather than a duplicate-rejecting insert.

**Seeded placeholder row.** Per the user's explicit instruction (a documented exception to "never
mock data for dev/prod," plan section 5) `ensureBotBlockerIpApiLookupIndexes` also performs a
`$setOnInsert`-only upsert of exactly one row into `botblockerIpApiLookupsV4`, keyed on an RFC 5737
`TEST-NET-3` address (`203.0.113.10`) that can never collide with a real visitor IP —
`vendor: "placeholder"`, `score: 0`, a `rawResponse` explicitly noting it is a seed, and a 24-hour
`expiresAt` from whichever boot inserted it. `$setOnInsert`-only (not refreshed on every boot) means
it is genuinely idempotent — safe to call on every server start like every other
`ensureBotBlocker*Indexes` step — and if the TTL index ever expires and deletes it, the next boot
naturally reseeds it with a fresh `expiresAt`, the same self-healing convention
`ProjectService#ensureDemoProject`'s doc comment describes.

**Vendor client (typed "unavailable" placeholder, no live HTTP integration).** New
`backend/packages/api/src/ip-reputation-client.ts` mirrors the existing
`createSpacesClient` pattern (`backend/packages/api/src/spaces-client.ts`) exactly: a factory
function, `createIpReputationVendorClient`, that returns `undefined` until all three new
`BOTBLOCKER_IP_REPUTATION_VENDOR_NAME`/`_URL`/`_API_KEY` config values are set. Per the plan's own
explicit exclusion ("no live external vendor HTTP integration until real credentials exist"), the
returned client's `lookup` method is itself an intentional placeholder that always rejects — even
once all three variables are configured, since no real vendor has been chosen yet and this
project's own rule is to never fabricate a real HTTP integration against an unknown vendor's actual
request/response shape. Implementing the real call later is a scoped, single-function change inside
this one module.

**Composed (unwired) awaited-lookup service.** New
`backend/packages/api/src/botblocker-ip-reputation-service.ts` implements
`BotBlockerIpReputationService#getReputation(ip, now)`, exactly matching plan correction 6
("awaited, not fire-and-forget"): checks the cache by IP first via `findByIp`; if a row exists and
is not yet past its `expiresAt`, returns it without any vendor call; otherwise, only if a vendor is
configured, awaits `lookup`, persists the result via `upsertEntry` (fixed 24-hour freshness window,
a caching-policy constant, not a user-configurable secret), and returns it. Resolves to `undefined`
— never throws, never blocks indefinitely — for an invalid IP, an unconfigured vendor, or a failed
vendor call, so a not-yet-credentialed or momentarily-unavailable vendor can never stall or break
whatever step 7 builds around this. This service is constructed in `server-context.ts` (below) but
is not called from any route yet — the actual `rapidAuthMutation` two-branch wiring that calls it is
step 7, explicitly out of scope for this session.

**Config.** `backend/packages/api/src/config.ts` gained three new optional fields —
`BOTBLOCKER_IP_REPUTATION_VENDOR_NAME` (plain string), `BOTBLOCKER_IP_REPUTATION_VENDOR_URL` (must
be a URL), `BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY` (plain string) — following the exact optional
deferred-credential convention every other provider in this project uses (Stripe, Spaces, VoIP.ms).
No cross-field `superRefine` requirement was added (matching the `SPACES_*` quartet's own
convention of an inline all-or-nothing check inside the client factory, not a schema-level one).

**Wiring.** `backend/packages/api/src/persistence.ts` registers
`ensureBotBlockerIpApiLookupIndexes` in the existing isolated `ensureIndexStep` startup sequence.
`backend/apps/server/lib/server-context.ts` constructs one `BotBlockerIpApiLookupPersistence` and
one `BotBlockerIpReputationService` (the latter wrapping the former plus the vendor config) and
exposes them on `ServerContext` as `botBlockerIpApiLookups`/`botBlockerIpReputation`, alongside the
existing BotBlocker services — matching the same "construct now, wire into a route later" pattern
steps 3–4's persistence classes already established.

**Tests.** New `botblocker-ip-api-lookup-persistence.test.ts` covers index creation (including the
TTL index), idempotent placeholder seeding across repeated calls, v4/v6 entry creation with
family-prefixed IDs, upsert-refresh-in-place semantics, invalid-IP rejection, and cross-family
`findByIp`. New `ip-reputation-client.test.ts` covers the all-or-nothing configured/unconfigured
factory behavior and confirms `lookup` rejects as the documented placeholder. New
`botblocker-ip-reputation-service.test.ts` covers: invalid IP short-circuits before touching the
cache or vendor; a fresh unexpired cache hit never calls the vendor; a cache miss with no vendor
configured resolves `undefined` without blocking; an expired cache row with no vendor configured
also resolves `undefined`; and a configured vendor's failing call resolves `undefined` rather than
throwing or writing a stale cache row.

**Verification.** `@powerotp/contracts` was unaffected (no contract types were needed — this cache
has no admin-facing schema, unlike the ASN/blacklist tables) but was rebuilt anyway so
`@powerotp/api` resolved a fresh `dist/`. `@powerotp/api`: `tsc -p tsconfig.json` (build) and
`tsc -p tsconfig.json --noEmit` (typecheck) both passed cleanly; the full workspace test suite
passed **290/290** (up from 275/275 in the prior entry, +15 new tests, zero failures).
`@powerotp/backend`: cleared the stale `.next/` and `tsconfig.tsbuildinfo` first (this session's
`server-context.ts` change would otherwise typecheck against a stale generated route/type cache),
then `tsc --noEmit` passed with zero errors and the focused test list (`app/health/route.test.ts`,
`app/route-inventory.test.ts`, `app/v1/botblocker/phase8-http.test.ts`,
`app/v1/botblocker/policy-route.test.ts`, `lib/**/*.test.ts`) passed **15/15**. A full
`npm run verify` (build + lint + test, every workspace) then passed with **zero failures across
every reported suite** — no OneDrive-related build interference this session, since the working
copy already lives at `C:\local only folder\POWEROTP` (relocated in a prior session).

**Documentation.** Updated `POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`'s execution
breakdown to mark step 6 complete with a link to this entry.

**Exclusions and operations.** No `rapidAuthMutation` wiring was added (step 7, not this session) —
`BotBlockerIpReputationService` is constructed and available on `ServerContext` but called from
nowhere yet. No live external vendor HTTP integration exists — `ip-reputation-client.ts#lookup`
remains an intentional placeholder that always rejects, per the plan's own explicit exclusion. No
admin routes or contract schemas were added for this cache (the plan does not call for any — unlike
the ASN classification/type-score tables, this collection has no admin-facing CRUD surface). No
scoring, allow/blacklist decisioning, Passport/PaidTokenPass behavior, billing, deployment, DNS, or
customer activation was touched. No `.env` file was read or changed (none exist locally on this
machine — all real secrets live on the DigitalOcean droplet/App Platform config, per the standing
project rule). No migration was performed; the one seeded placeholder row is an explicit,
user-approved exception to "never mock data for dev/prod," not a migration.

## 2026-08-17 — BotBlocker Phase 16 (partial): wire the two-branch decision into `rapidAuthMutation`

**Status: Phase 16 in progress, not complete.** This entry covers step 7 of the eight-step execution
breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md):
replacing `rapidAuthMutation`'s hardcoded `decision: { status: "unavailable", reason:
"not_implemented" }` with the real two-branch precedence (blacklist exact-match, then
network-range -> ASN classification -> ASN type-score, then the awaited external vendor lookup
only when required), and landing the resolved result on the gate session row at creation time.
Steps 1–6 (IP-hash reversal, dedicated IP blacklist, network ranges, ASN classification/type
scores, retiring the `botblockerRapidList` scaffold, the external IP-reputation vendor cache)
shipped in the four prior sessions (commits `74ad253`, `899facf`, `f423cc7`, `6b71382`). Step 8 —
the closing documentation pass (API route inventory, control matrix) beyond this entry — is **not
implemented** and remains future fresh-session work.

**Composed (now wired) network-intelligence service.** New
`backend/packages/api/src/botblocker-network-intelligence-service.ts` implements
`BotBlockerNetworkIntelligenceService#resolve(ip, now)`, composing the five already-built pieces
named in the plan exactly per its "Runtime integration" mermaid sequence diagram: a dedicated
IP-blacklist exact-match lookup short-circuits first (an active match — not revoked, not past its
`expiresAt` — resolves `{ blacklisted: true }` without ever touching the network-range tables);
otherwise a network-range lookup joins to `botblockerAsnClassifications` (an ASN with no
persisted classification row is treated as `"unclassified"`, matching "every ASN defaulting to
unclassified, never a fabricated type") and then to `botblockerAsnTypeScores#listAllScores` for
that resolved type's `score`/`requiresApiLookup`; only when `requiresApiLookup` is `true` does it
await `BotBlockerIpReputationService#getReputation` (already cache-checked/awaited internally,
never fire-and-forget) before resolving. Per the plan's explicit exclusion ("no final
weighted/thresholded risk score... Phase 17"), the network-range/ASN/vendor-score chain is
returned as informational enrichment only (`networkClassification`/`ipReputation` on the
resolution) — it never produces a visitor-facing outcome itself; a blacklist match is the only
input this phase converts into a decision, and that conversion (`"otp"`) happens in
`rapidAuthMutation`, not inside this service, keeping the service itself free of protocol-level
response shaping.

**`botblocker-asn-classification-persistence.ts`** gained `findByAsn(asn)`, a single-ASN lookup the
network-intelligence chain needs (`listClassifications` was paginated/type-filtered only,
insufficient for this join) — resolves `undefined` for an ASN with no row yet rather than a
fabricated default document, leaving the "unclassified" substitution to the calling service per the
plan's own convention.

**Gate session enrichment lands at creation time (plan correction 5).** New optional fields
`GateSessionDocument.networkClassification`/`.ipReputation` in
`botblocker-intelligence-persistence.ts` (session-level snapshots: `{ asn, asnOrg, asnType, score,
requiresApiLookup }` and `{ vendor, score }` respectively — the vendor's raw response payload stays
in `botblockerIpApiLookupsV4`/`V6`'s own cache row, not duplicated onto every session).
`GateSessionDocument.latestDecision` (declared since an earlier phase but never previously written
by any caller) is now set to `"otp"` on a blacklist match. `BotBlockerSessionPersistence
#openGateSession` and `BotBlockerIngestionService#startSession` both gained matching optional
parameters, forwarded straight through to the insert path only — the pre-existing `existingById`
idempotent-reuse branch is untouched, so a session created before this session's own enrichment ran
(or created by a caller that never resolved it, e.g. the browser-assessment late-session-creation
fallback) simply has no enrichment fields, exactly as "at creation time" implies rather than a
later backfill. `backend/packages/contracts/src/botblocker-persistence.ts`'s `GateSessionRecordSchema`
gained matching optional `networkClassification`/`ipReputation` sub-schemas (imported `AsnTypeSchema`
from `botblocker-api-control.ts`, no circular import) to keep mirroring the real persistence shape,
per the same convention step 1's `ip` field rename followed — this contract is not consumed by any
route yet, so no other file needed touching for it.

**`rapidAuthMutation` wiring.** `backend/apps/server/lib/botblocker-http.ts` now calls
`context.botBlockerNetworkIntelligence.resolve(clientIp(request), new Date())` once, before
`startSession`, and threads the result both into `startSession`'s new optional parameters (so the
gate session row is enriched atomically at creation) and into the response's `decision` field: a
blacklist match returns `{ status: "ready", outcome: "otp" }`; every other outcome (no client IP, no
blacklist/range match, or a resolved type that does not require the vendor call) leaves `decision`
exactly as it was before this session — `{ status: "unavailable", reason: "not_implemented",
retryable: false }` — since no final scoring/threshold logic exists yet (Phase 17). This is a
literal, non-inventive reading of the plan's own repeated "no final weighted/thresholded score"
exclusion: the ASN/vendor-score chain is real, wired, and lands on the session row, but nothing in
this phase converts a bare `score` number into a second visitor-facing outcome value beyond the two
the protocol already defines (`allow`/`otp`) — that conversion is explicitly Phase 17's job once the
user supplies weights/decay/threshold rules.

**Wiring.** `backend/apps/server/lib/server-context.ts` constructs one
`BotBlockerNetworkIntelligenceService` (wrapping the five already-constructed pieces:
`botBlockerIpBlacklist`, `botBlockerNetworkRanges`, `botBlockerAsnClassifications`,
`botBlockerAsnTypeScores`, `botBlockerIpReputation`) and exposes it on `ServerContext` as
`botBlockerNetworkIntelligence`. No new persistence classes were added, matching the plan's own
expectation for this step — only the one new composing service, plus the single `findByAsn` method
on an already-existing persistence class.

**Tests.** New `botblocker-network-intelligence-service.test.ts` covers: no client IP resolves no
signal; an active blacklist match short-circuits before the network chain runs; a revoked entry and
a past-`expiresAt` entry are both correctly treated as inactive and fall through to the network
chain; an IP outside every loaded range resolves no signal; an ASN with no classification row
defaults to `"unclassified"`; the fast-immediate branch returns without any vendor call when
`requiresApiLookup` is `false`; the vendor lookup is awaited and its result attached only when
`requiresApiLookup` is `true`; and the network classification still returns (with no `ipReputation`)
when the vendor lookup itself resolves `undefined`. New coverage in
`botblocker-asn-classification-persistence.test.ts` for `findByAsn` (found vs. unknown ASN). New
coverage in `botblocker-session-persistence.test.ts` for both directions: all three new optional
fields landing on a newly created session row, and all three being entirely absent (not present as
`undefined` keys) when nothing was resolved.

**Verification.** `@powerotp/contracts`: rebuilt (`tsc -p tsconfig.json`) cleanly; full workspace
test suite passed **173/173** (unchanged from the prior entry — this session's contract change was
additive/optional-only, no new or removed test cases). `@powerotp/api`: rebuilt cleanly; `tsc -p
tsconfig.json --noEmit` passed with zero errors; full workspace test suite passed **302/302** (up
from 290/290, +12 new tests, zero failures). `@powerotp/backend`: cleared the stale `.next/` and
`tsconfig.tsbuildinfo` first (this session's `server-context.ts`/`botblocker-http.ts` changes would
otherwise typecheck against a stale generated route/type cache), then `tsc --noEmit` passed with
zero errors and the focused test list (`app/health/route.test.ts`, `app/route-inventory.test.ts`,
`app/v1/botblocker/phase8-http.test.ts`, `app/v1/botblocker/policy-route.test.ts`,
`lib/**/*.test.ts`) passed **15/15** (unchanged — `rapidAuthMutation` itself still has no dedicated
unit-test file, matching its pre-existing untested status; its logic is now backed indirectly by the
new `BotBlockerNetworkIntelligenceService` and session-persistence tests above, which exercise every
branch this session added). A full `npm run verify` (build + lint + test, every workspace) then
passed with **zero failures across every reported suite**, including the production Next.js build
successfully compiling `rapidAuthMutation`'s new network-intelligence wiring.

**Documentation.** Updated `POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`'s execution
breakdown to mark step 7 complete with a link to this entry.

**Exclusions and operations.** No admin override list, no final weighted/thresholded score, and no
Passport/paid-allow blacklist bypass were added — all remain explicitly out of scope (the first two
permanently per the plan's own exclusions pending Phase 17 weights/decay/threshold rules, the third
pending Phase 21-23 Passport/PaidTokenPass). No live external vendor HTTP integration exists —
`ip-reputation-client.ts#lookup` remains the same intentional placeholder from the prior session,
untouched by this one. No new persistence classes, admin routes, or contract mutation schemas were
added. No scoring beyond what's already described in the plan's data model sections 1-5, no
aggregation into `userIntelligence` (Phase 17), billing, deployment, DNS, or customer activation was
touched. No `.env` file was read or changed. No migration or seed was performed. Step 8 (the closing
documentation pass beyond this entry — API route inventory review, control matrix) remains for a
future session. No commit or push was performed; git status was left for the user to review.

## 2026-08-17 — BotBlocker Phase 16 (complete): closing documentation pass

**Status: Phase 16 complete.** This entry covers step 8 — the final step of the eight-step execution
breakdown in
[`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md).
Steps 1–7 shipped across five prior sessions/commits — `74ad253` (steps 1–2: IP-hash reversal,
dedicated IP blacklist), `899facf` (steps 3–4: network ranges, ASN classification/type scores),
`f423cc7` (step 5: retired the `botblockerRapidList` scaffold), `6b71382` (step 6: external
IP-reputation vendor cache), `449893e` (step 7: wired the two-branch decision into
`rapidAuthMutation`) — see the five dated entries directly above for exact files/tests/verification.
This entry is a docs-only pass: no application code was added or changed.

**Phase 16 final state, summarized.** A rapid-auth request now resolves real network intelligence
via `BotBlockerNetworkIntelligenceService#resolve`: a dedicated per-family IP-blacklist exact-match
lookup runs first (respecting `revokedAt`/`expiresAt`) and, on an active match, short-circuits to
`decision: { status: "ready", outcome: "otp" }`; otherwise a synchronous indexed network-range lookup
joins to `botblockerAsnClassifications` (defaulting to `"unclassified"` for any ASN with no
persisted row) and then to `botblockerAsnTypeScores`, awaiting the external vendor lookup
(`botblockerIpApiLookupsV4`/`V6`, cache-checked first, one seeded placeholder row) only when the
resolved type's `requiresApiLookup` is `true`. Every other outcome still leaves `decision` exactly as
before this phase — `{ status: "unavailable", reason: "not_implemented", retryable: false }` — since
no final weighted/thresholded score exists yet (Phase 17). The resolved result lands on the new gate
session row (`GateSessionDocument.networkClassification`/`.ipReputation`/`.latestDecision`) at
creation time only, never backfilled. Raw IP is stored throughout (the Phase 15 `ipHash` field was
removed); the only remaining hash is the keyed fingerprint lookup. Six new MongoDB collections exist
(`botblockerIpBlacklistV4`/`V6`, `botblockerNetworkRangesV4`/`V6`, `botblockerAsnClassifications`,
`botblockerAsnTypeScores`, `botblockerIpApiLookupsV4`/`V6` — nine physical collections total across
the v4/v6 splits) with four new admin routes (`ip-blacklist`, `ip-blacklist/revoke`,
`asn-classifications`, `asn-type-scores`) and one retired stub (`rapid-list`).

**API route inventory — independently re-confirmed.** Re-checked `docs/API_ROUTE_INVENTORY.md`
against the actual route tree (a repository glob of every
`backend/apps/server/app/v1/{control/}botblocker/**/route.ts` file, not just trusting the prior
session's note) rather than only trusting the prior session's finding: all four new Phase 16 admin
routes (`ip-blacklist`, `ip-blacklist/revoke`, `asn-classifications`, `asn-type-scores`) are present
and correctly documented, the retired `rapid-list` row is gone, and the eleven runtime
`/v1/botblocker/*` routes and remaining seven `/v1/control/botblocker/*` routes match the file tree
exactly (7 control routes, 11 runtime routes, no extra or missing rows either direction). No edit was
needed.

**Control matrix and threat model — reviewed, three rows updated.**
`docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`'s `C1.1` and `A.5.34` rows (corrected
during step 1 to state raw-IP retention plainly) still read accurately for the IP-hash-reversal
claim itself, but both referred to it only as "the Phase 16 network-intelligence **design**," which
undersold that IP-hash reversal, the dedicated IP blacklist, ASN classification/scoring, and the
IP-reputation cache are now actually shipped, not just designed — both rows were reworded to say so
and to name the new collections as admin-managed/vendor-sourced operational security data (not
visitor-supplied content, so the confidentiality/PII analysis is unchanged). `PI1`'s "decision
processing remains Phase 16/17/20" was genuinely stale now that step 7 shipped: a control's *actual*
status changed, since a blacklist match now deterministically produces a real `otp` decision — the
row was reworded to describe that one real branch while keeping the full weighted/thresholded score
combination correctly attributed to Phase 17/20. `docs/THREAT_MODEL.md`'s BotBlocker ingestion
section (the fingerprint/raw-IP paragraph corrected in step 1) and its "Cross-project data access"
section (which already described blacklist/network-reputation signals as a private, non-returned
server-side input) were both re-read and found still accurate with no further Phase 16 mechanism
requiring a new row or correction; no other row in either document names a mechanism this phase
touches. No new rows were added — no control's status changed outside the three above.

**As-built internal-consistency audit.** Re-read all five prior Phase 16 dated entries' "Exclusions
and operations" sections (and the surrounding body text) specifically checking for stale
present-tense claims like "not called from any route" now that step 7 has shipped. Every instance
found (`botblocker-ip-blacklist-persistence`'s "none of it is wired into `rapidAuthMutation` yet
(that is step 7, later)" in the steps-1–2 entry; `BotBlockerIpReputationService`'s "constructed...
but called from nowhere yet" alongside "step 7, not this session" in the step-6 entry) is already
explicitly scoped to "as of that session"/"until step 7" rather than stated as an unqualified,
still-current fact — each entry is a dated historical record of what was true when it was written,
and a reader progressing through the dated entries in order (as this document is structured) reaches
step 7's entry immediately afterward, which correctly states the current, now-wired reality. No
sentence was found to be factually wrong as written; no edit was made under this item.

**Verification.** No application code changed this session, so per this project's tightened
verification-effort rule no build/test/typecheck run was warranted. `git fetch origin` plus
`gh run list --branch main` confirmed `449893e` (step 7, current `HEAD` at session start) has a
**successful** `Verify` CI run — the same `npm run verify` this session would otherwise have run
manually already passed in CI for the exact commit these doc changes build on, so no redundant local
`npm run verify` was run.

**Documentation.** This entry itself. Marked step 8 complete in
`POWEROTP_BOTBLOCKER_PHASE16_NETWORK_INTELLIGENCE_PLAN.md`'s execution breakdown, linking here, which
closes out that plan's entire eight-step breakdown.

**Exclusions and operations.** Per this phase's own explicit exclusions (unchanged, not
re-litigated): no final weighted/thresholded score and no admin override list (both Phase 17), no
live external vendor HTTP integration (`ip-reputation-client.ts#lookup` remains an intentional
placeholder), no Passport/paid-allow blacklist bypass (documented future note only), and
`rapidAuthMutation` still has no dedicated unit-test file of its own (accepted gap from step 7,
exercised indirectly via `BotBlockerNetworkIntelligenceService`'s and
`BotBlockerSessionPersistence`'s own test files). This entry closes Phase 16 entirely; Phase 17
(weighted scoring, aggregation into `userIntelligence`, admin thresholds) is explicitly not started
and requires a fresh planning session with the user's own weights/decay/threshold rules. No `.env`
file was read or changed. No migration or seed was performed. No commit or push was performed by
this session unless the user explicitly requested it; git status was left for the user to review.

## 2026-08-17 — BotBlocker Phase 17 (partial): fingerprint contracts and collector

**Status: first Phase 17 production slice complete.** Added the shared, versioned browser
fingerprint contract and once-per-new-gate-session collector. This entry marks only execution
breakdown step 1 complete; Phase 17 as a whole remains in progress.

**Contracts.** Added `fingerprint-components.ts` and `fingerprint.ts` under
`backend/packages/contracts/src` and exported them from the shared package. The
`fingerprintVersion: 1`, `collectorVersion: "5.2.0"` vector recognizes exactly the 42
FingerprintJS v5.2.0 components approved in the Phase 17A plan. Missing component data is
omitted without failing the vector. Every present component is a closed `available` value or one
of `unavailable`, `blocked`, `skipped`, `unstable`, `unsupported`, or bounded
`collector_error/collection_failed`. Values enforce finite numbers, safe/ranged
integers, fixed enums, strict nested objects, bounded strings and arrays, and a 56 KiB total
vector cap. Canvas, WebGL, audio, and locale library sentinel values are reduced to the matching
typed state. No library visitor ID, confidence, client/component hash, raw error, duration,
arbitrary component/property, page/form/authentication data, URL query, or fragment belongs to
the contract. `InitialBrowserProofEvidenceSchema` now carries the vector as an optional sibling
of behavior `evidence`, preserving typed absence for older clients and keeping all behavior
report schemas unchanged.

**Collector and bridge.** Added `libraries/gate-core/src/fingerprint-collector.ts` using exactly
pinned `@fingerprintjs/fingerprintjs` `5.2.0` from the installed package, with
`load({ monitoring: false })`; no CDN loader or statistics request is used. The collector maps
only the fixed component inventory and never returns FingerprintJS identity/confidence/error
authority. A scoped in-memory promise cache keyed by gate-session ID prevents retries or browser
coordinator re-creation from rerunning probes for the same session while a new gate session gets
its own collection. `gate-node`'s browser coordinator obtains the current HttpOnly-bound session
bootstrap first, collects for that returned session ID, and posts the optional vector through
the existing same-origin initial-evidence bridge. The server-held site credential is added only
inside the existing first-contact service boundary; neither it nor the scoped visitor token,
profile ID, stable HMAC, or server authorization value is exposed to browser code or bridge
responses. Five-second, 30-second, navigation, hide, and exit behavior reports neither recollect
nor embed fingerprint data. The Express and Next React entry points forward the same optional
collector dependency used by the shared browser coordinator, allowing deterministic browser
tests without running real canvas, audio, font, or WebGL probes in Happy DOM.

**Focused tests and verification.** Added contract coverage for a complete available vector,
omitted missing components, every present component wrapper, all typed unavailable states,
finite/range/safe-integer and
nested string/array/object bounds, total payload size, strict unknown-field rejection, library
authority rejection, and prohibited page/form/authentication data. Collector tests cover
`monitoring: false`, same-session retry/re-render deduplication, new-session recollection,
v5.2.0 tuple/sentinel mapping, selected future profile fields, and bounded failure handling.
Browser/runtime and raw Node bridge tests cover optional absence, initial-only transport,
credential separation, and continued exclusion from recurring reports. Focused builds and
strict typechecks passed for `@powerotp/contracts`, `@powerotp/gate-core`,
`@powerotp/gate-node`, `@powerotp/gate-express`, and `@powerotp/gate-next`. Their workspace test
suites passed respectively **181/181**, **46/46**, **21/21**, **22/22**, and **27/27**, including
the unchanged sensor cadence and sanitization suites. No full-monorepo verification was run
locally.

**Explicitly not shipped.** This slice adds no `fingerprintData` MongoDB collection or record,
retention/index, server canonicalization, stable HMAC, profile matching/change/alias behavior,
gate-session-to-`userIntelligence` synchronizer, current/prior IP update, scoring engine or admin
UI, callback, `riskEvents` reducer, external IP-vendor profile mapping, migration, seed,
deployment, or traffic activation. No `.env` file was read or changed. No commit or push was
performed; the working tree remains for user review.

## 2026-08-18 — BotBlocker Phase 17 (partial): raw fingerprint persistence and verify lookup

**Status: second Phase 17 production slice complete.** The rapid-auth path now validates and
forwards the optional raw fingerprint vector to transactional persistence. The shared
`fingerprintData` collection retains one current 548-day raw vector per `userIntelligence` row.
Server observation time and gate-session-ID tie-breaking reject stale replacement, exact replay is
idempotent at the fingerprint-row boundary, conflicting equal-order raw replacement is rejected,
full scope is enforced, and transaction failure leaves no partial fingerprint/profile/session
write. The collection has a unique profile relationship, scoped raw-lookup support, and TTL indexes.

**Identity and hash boundary.** The former pre-persistence fingerprint HMAC and its copies on
`gateSessions` and `fingerprintData` are removed. Without a trusted profile binding, home
persistence may select an existing profile only by exact equality of the saved raw version,
collector version, and complete component object; IP is not part of selection. A trusted
server-held profile binding takes precedence. No fuzzy, partial, closest, subnet, IP-only, or
inbound-hash match exists.

For an accepted current vector, persistence projects only the approved bounded stable-source
categories onto `userIntelligence`: normalized platform family; CPU architecture/bitness and
collector architecture; optional mobile model; hardware concurrency; coarsened memory; maximum
touch points; stable display class; bounded WebGL outputs; canvas/audio/font/font-preference
outputs; and browser vendor/family without full versions. Existing successful source categories
survive a later unavailable category. The versioned HMAC-SHA-256 lookup is then derived from that
projected user-row object under `BOTBLOCKER_INTELLIGENCE_HASH_SECRET` and stored only as
`fingerprintVerifyLookup` on the same row. Missing source fields or an unavailable key produce a
typed unavailable lookup without dropping the raw vector. A changed accepted row source replaces
the current lookup; no aliases are retained.

**Focused verification.** `@powerotp/contracts` build passed and its suite passed **183/183**
tests across 46 suites. `@powerotp/api` build passed and its final suite passed **314/314** tests
across 87 suites. The touched `@powerotp/backend` server wiring passed `tsc --noEmit`. No
full-repository verification was run.

**Explicitly not shipped.** This slice does not claim the complete initial middleware request or
initial immutable risk-event write, persistent site-return cookie, Passport binding, safe durable
visitor-token metadata, minute-29 refresh, middleware bearer replacement, selected operator
scoring-field synchronization, IP history/reuse aggregation, profile scoring, callbacks, reducer,
external-vendor profile mapping, edge publication, or global verify Worker. No environment file,
migration, seed, deployment, or customer traffic was changed. No commit or push was performed.

## 2026-08-18 — BotBlocker Phase 17 (partial): initial session and risk-event persistence

**Status: third Phase 17 production slice complete.** Initial RapidAuth now passes the complete
validated authenticated request envelope into persistence. The bounded session snapshot preserves
the request context, complete available raw browser/fingerprint input, candidate proofs, browser
risk evidence, server observation time, and available server-derived blacklist/network/reputation
evidence. The trusted visitor IP comes from the authenticated adapter request context, not the
adapter-to-API transport address, remains raw, and is omitted when unavailable.

The scoped `gateSessions` row and the same snapshot as one immutable
`riskEvents.recordType: "initial_request"` row are inserted in the existing MongoDB transaction
before fingerprint/profile persistence completes. Both records carry the exact
customer/project/site, gate-session, and user-intelligence binding. Exact request replay returns
the existing session without another event, fingerprint, or profile update; changed equal/older
input is rejected as stale and changed newer input as conflicting. A failed session, initial-event,
fingerprint, or profile write aborts all four categories.

**Visitor authority and retention.** The 30-minute visitor bearer is issued only after durable
session creation. Before the response is returned, the session stores only a random token ID,
expiry, SHA-256 nonce digest, and SHA-256 token digest. Neither the reusable bearer nor raw token
nonce is persisted. Gate-session headers, the initial event, and later behavior/risk-event inputs
now use the approved 90-day retention boundary; `fingerprintData` and `userIntelligence` remain at
548 days. A later browser-assessment request can no longer fabricate a missing initial session
from incomplete report data.

**Focused verification.** `@powerotp/contracts` build passed and its corrected final suite passed
**184/184** tests across 46 suites. `@powerotp/api` build passed and its suite passed **318/318**
tests across 87 suites. The touched `@powerotp/backend` server integration passed `tsc --noEmit`.
No full-repository verification was run.

**Explicitly not shipped.** This slice adds no site-return cookie, Passport binding, minute-29
refresh route or middleware bearer replacement, gate-session IP/profile synchronizer, operator
scoring fields/runtime, callback/pull flow, behavior-event reducer, external-vendor profile
integration, billing, edge publication, or global verify Worker. No environment file, migration,
seed, deployment, or customer traffic was changed. No commit or push was performed.

## 2026-08-18 — BotBlocker Phase 17A (partial): gate-session profile synchronization, IP evidence

**Status: fourth Phase 17 production slice complete.** This entry covers implementation-split item
4 of the Phase 17A plan — gate-session profile synchronization's IP evidence, superseding the
Phase 16 `ipObservations` placeholder (which only ever held one entry because its matching rule
never produced real history). `openGateSession` now applies this synchronization inside its
existing at-most-once MongoDB transaction, immediately after the fingerprint/verify-lookup
projection and before the session/profile write commits.

**`userIntelligence.currentIp` and `recentIpHistory`.** Replaced `ipObservations` with `currentIp`
(`ip`, optional `asnScore`, explicit `blacklisted`) and a unique least-recently-used
`recentIpHistory` of at most 20 prior entries, exactly per plan: a repeated exact IP refreshes
`currentIp` in place (ASN score uses latest-successful replacement — an incoming session without a
resolved ASN score keeps the last known score for that exact IP) without touching history; a
changed IP removes any duplicate occurrence of both the incoming and outgoing IP, moves the
outgoing `currentIp` into the newest history slot, and trims to the 20 most recent unique entries.
A missing trusted IP (or a missing explicit blacklist result) omits every one of these updates and
leaves the profile's existing evidence untouched — never fabricated. `blacklisted` is stored as the
observation-time dedicated exact-IP blacklist result already resolved by the existing Phase 16
network-intelligence chain, never inferred from `latestDecision`.

**`userIntelligence.currentIpReuse`.** Added separate system-wide (`global`) and same-site (`site`)
distinct-profile counts for the current exact IP over the latest 1/7/30 days
(`distinctProfiles1d/7d/30d`), computed by `BotBlockerIntelligencePersistence#countIpReuse` from the
retained 90-day `gateSessions` dataset — the trusted session/profile relationship — by counting
distinct `userIntelligenceId` values, never raw report/session counts. The read runs inside the
same transaction and `session`, so it sees the just-inserted current gate session. Omitted whenever
the trusted IP itself is unavailable.

**Persistence and indexes.** New `backend/packages/api/src/botblocker-intelligence-persistence.ts`
types `IpEvidence`, `IpReuseCounts`, `IpReuseSummary`, and exported `sameBotBlockerScope` (replacing
a duplicated private helper previously defined separately in both
`botblocker-intelligence-persistence.ts` and `botblocker-session-persistence.ts`). Added a
non-unique `{ ip: 1, lastObservedAt: -1 }` `gateSessions` index supporting `countIpReuse`'s
unscoped system-wide scan, and replaced the `userIntelligence` `"ipObservations.ip"` index with
`"currentIp.ip"`. `backend/packages/contracts/src/botblocker-persistence.ts` replaced
`IpObservationSchema` with `IpEvidenceSchema` and added `IpReuseSummarySchema` (with a monotonic
1d ≤ 7d ≤ 30d refinement) on `UserIntelligenceRecordSchema`; these boundary schemas remain exercised
only by their own test file, matching the existing pattern of the other `*RecordSchema` exports.
`backend/packages/api/src/botblocker-operations-service.ts`'s project-owned visitor report now reads
`visitor.currentIp?.ip` instead of `visitor.ipObservations[0]?.ip` — the site-owner-facing `ip` field
in that response is unchanged; only the internal source field name and shape moved.

**Focused verification.** `@powerotp/contracts` build passed and its suite passed **185/185** tests
across 46 suites. `@powerotp/api` build passed and its suite passed **326/326** tests across 88
suites. The touched `@powerotp/backend` server workspace passed `tsc --noEmit`. No full-repository
verification was run.

**Explicitly not shipped.** This slice adds no operator scoring fields/runtime, callback/pull flow,
behavior-event reducer, external-vendor profile integration, site-return cookie, Passport binding,
minute-29 refresh, middleware bearer replacement, billing, edge publication, or global verify
Worker. No environment file, migration, seed, deployment, or customer traffic was changed. No
commit or push was performed.

## 2026-08-18 — BotBlocker: split `@powerotp/contracts` browser-safe export (resolves the 819c7e4 open issue)

**Status: resolved, cross-cutting contracts/bundling fix, independent of Phase 17 runtime work.**
The open issue flagged in the 819c7e4 session — `@powerotp/contracts`'s single barrel export letting
backend-only Mongo persistence document schemas and admin/control-plane contracts leak textually
into customer-facing browser bundles regardless of what those bundles actually reference (bundlers
do not reliably tree-shake `export *` re-export chains) — is fixed by physically splitting the
module graph rather than relying on tree-shaking.

**New `@powerotp/contracts/browser` subpath.** Added `backend/packages/contracts/src/index.browser.ts`,
a second barrel re-exporting only the closed set of files with zero backend-only structure:
`botblocker.ts` (wire protocol, browser evidence, behavior report, decision envelope),
`botblocker-browser.ts` (browser proof evidence, advisory snapshot), `botblocker-clearance.ts`
(site-clearance wire shapes), `botblocker-proofs.ts` (Passport/PaidTokenPass/risk-event proof
shapes), `botblocker-signing.ts` (Ed25519 signature wire shapes and canonicalization — never
private key material), and `fingerprint.ts`/`fingerprint-components.ts` (FingerprintJS vector
contracts). This exact set was derived by enumerating every symbol gate-core and
`gate-node/browser.ts` actually import from `@powerotp/contracts` and tracing each to its defining
file — confirmed by grep, not assumed. `package.json` gained a matching `"./browser"` export
condition (`types`/`import`), mirroring the existing `@powerotp/gate-node`'s own `"./browser"`
subpath pattern already in this monorepo. The root `.` export (`index.ts`) is completely unchanged;
every existing backend/server-side consumer keeps working exactly as before.

**Consumers switched to the browser-safe subpath.** All eleven `@powerotp/contracts`-importing files
in `libraries/gate-core/src` (`controller.ts`, `decision.ts`, `fingerprint-collector.ts`,
`recommendation.ts`, `sensor.ts`, `sensor-analytics.ts`, `sensor-evidence.ts`, and their four
`.test.ts` files) plus `libraries/gate-node/src/browser.ts` and its `browser.test.ts` now import
from `@powerotp/contracts/browser`. Every other `@powerotp/contracts` consumer — gate-node's
server-side `server.ts`/`runtime.ts`/`advisory.ts`/`bridge.ts`/`cookies.ts`/`http.ts`/`types.ts`,
gate-express, gate-next's server-side adapter, `sdk-js`, and every backend package — keeps importing
the root export unchanged, because none of that code is ever bundled for a browser.

**Backend-only files marked.** Added an explicit "backend-only, never reachable from
`@powerotp/contracts/browser`" doc-comment banner to `botblocker-persistence.ts` (Mongo document
schemas) and `botblocker-policy-persistence.ts` (`policyReleases` document schema) so a future editor
sees the boundary before adding a field.

**Verified with a real bundle, not just a name-surface check.** Rebuilt the `gate-next` fixture's
actual Next.js production client bundle and grepped every compiled `.js` chunk under
`fixture/.next/static/` for `GateSessionRecordSchema`, `UserIntelligenceRecordSchema`,
`FingerprintDataRecordSchema`, `PolicyReleaseRecordSchema`, and `OperatorIpBlacklistMutationSchema` —
zero matches, confirmed before writing any test. Added a permanent regression test asserting exactly
that to `libraries/gate-next/src/react.test.tsx` ("Next production client bundles contain no
backend-only persistence or admin schema"), alongside the pre-existing credential-leak test. Also
added `backend/packages/contracts/src/index.browser.test.ts`, a faster unit-level guard asserting a
list of backend-only-file-unique names (`GateSessionRecordSchema`,
`UserIntelligenceRecordSchema`, `FingerprintDataRecordSchema`, `DurableRiskEventRecordSchema`,
`BotBlockerChallengeRecordSchema`, `PolicyReleaseRecordSchema`, `OperatorIpBlacklistMutationSchema`,
`OperatorAsnClassificationMutationSchema`, `CustomerVisitorSchema`,
`BotBlockerSiteConfigurationSchema`, `CustomerRegistrationSchema`, `UpdateProjectSchema`) are present
on the root export but absent from `./browser`'s export surface, plus a second test that the
browser-reachable widget contracts it needs are still present there.

**Focused verification.** Rebuilt and tested every directly affected workspace once each:
`@powerotp/contracts` build passed, suite passed **187/187** across 47 suites (was 185/185 before
this fix's own two new tests); `@powerotp/gate-core` build passed, suite passed **46/46**;
`@powerotp/gate-node` build passed, suite passed **21/21**; `@powerotp/gate-next` build passed
(including the real `next build fixture` production compile), suite passed **28/28** (was 27/27
before this fix's new bundle-content test); `@powerotp/gate-express` build passed, suite passed
**22/22**. `tsc -p tsconfig.typecheck.json` (`lint`) passed for `@powerotp/contracts`,
`@powerotp/gate-core`, and `@powerotp/gate-node`. No full-repository `npm run verify` was run — every
directly touched or dependent workspace was verified individually instead, and the root `index.ts`
barrel plus every non-browser consumer were left untouched, so no other workspace could regress.

**Explicitly not shipped.** This fix touches only the contracts export boundary and its direct
browser-reachable consumers. No Phase 17 runtime work (profile scoring, callbacks, reducer), site-
return cookie, Passport, minute-29 refresh, billing, edge publication, or global verify Worker was
touched. No environment file, migration, seed, deployment, or customer traffic was changed.
