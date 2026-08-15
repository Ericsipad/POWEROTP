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
hashed credential domain and every later-phase runtime capability returns a typed unavailable
response rather than a fabricated decision, score, challenge result, Passport result, paid
entitlement, or visitor.

Phases 9–13 add the framework-neutral browser gate and continuous sanitized sensor plus raw
Node HTTP, Express 5, and Next.js 16 App Router wrappers. The wrappers verify signed clearances
locally, keep site credentials server-only, expose bounded same-origin bridge routes, and
default every unbacked central capability to typed unavailable. The framework packages add
credential-free React root helpers without rewriting application streams or uploads; the
Next.js wrapper also provides native Node-runtime Proxy handling and App Router/discovery
handlers. There is still no real intelligence ingestion, matching, scoring, OTP orchestration,
Passport/PaidTokenPass implementation, billing/metering, production BotBlocker key, policy
release, credential, deployment, or traffic activation.

Phase 13A corrected the intended product boundary after the user identified that Phase 0 had
canonized the wrong interpretation. POWEROTP must be additive, plugin-directed, and
customer-enforced: middleware uses the site credential for first session contact and narrow
server-held visitor tokens thereafter, publishes recommended state, and customer plugin code
enforces it and explicitly calls the one argument-free OTP opener. Existing Phase 9–13 code
still automatically applies a page lock and does not yet expose the corrected state API;
Phases 13B–13D must fix that before Phase 14 can publish integrations.
`enabled: true` remains only stored preference and is insufficient for readiness. The existing
hosted-widget bot-signal honeypot and `/v1/projects/{projectId}/visitors` OTP dashboard route
remain separate from BotBlocker.

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
  `libraries/contracts/src/botblocker.ts`. Previously the plan named only an Express reference
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
module (`libraries/contracts/src/botblocker.ts`) defining versioned protocol identifiers, the
50–2,000 ms (200 ms default) decision-timeout contract, adapter/request-context types, the
sanitized browser-evidence contract, first/recurring/partial behavior-report contracts with a
report sequence/staleness helper, a decision-revision *envelope* (no `outcome` field — that is
Phase 2's job), and stable typed error/unavailable-response contracts. No route, middleware,
wrapper, or persistence was added — this phase is contracts only, exactly as scoped. Nothing in
the rest of the codebase imports these exports yet.

**Architecture decisions/clarifications recorded this phase:**

- Followed the existing `libraries/contracts/src/*.ts` convention exactly: zod schemas named
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
  `apps/api/src/interaction-tokens.ts`, per the session's explicit instruction to reuse that
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
  the pre-existing `libraries/contracts/tsconfig.json` excludes `src/**/*.test.ts` (needed so
  `npm run build` doesn't emit test files into `dist`), and both `lint` and `typecheck` reused
  that same build config — meaning **no test file in this package (including the pre-existing
  `index.test.ts`) was ever actually type-checked by `npm run typecheck`/`npm run lint`
  before this phase**, since `tsx` (used to *run* tests) only transpiles and never type-checks.
  This made the required `@ts-expect-error` type-level prohibited-field tests unenforceable as
  written. Fixed by adding `libraries/contracts/tsconfig.typecheck.json` (extends the same base
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

- `libraries/contracts/src/botblocker.ts` (new) — all Phase 1 contracts.
- `libraries/contracts/src/botblocker.test.ts` (new) — boundary tests (49/50/2000/2001 ms),
  prohibited-field tests (type-level `@ts-expect-error` plus runtime `safeParse` rejection),
  behavior-report/discriminated-union tests, `isStaleSequence` tests, decision-envelope tests,
  request-context tests, and unavailable/error-response tests.
- `libraries/contracts/src/index.ts` (added `export * from "./botblocker.js";`).
- `libraries/contracts/tsconfig.typecheck.json` (new) — see test-infrastructure fix above.
- `libraries/contracts/package.json` (`lint`/`typecheck` scripts point at the new typecheck
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
  same exposure. It is now fixed for `libraries/contracts` specifically. Other packages
  (`libraries/sdk-js`, `apps/api`, etc.) were not audited or changed this phase; if a future
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
`libraries/contracts/src/botblocker.ts` (or add a sibling file re-exported from `index.ts`) with
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

- `libraries/contracts/src/botblocker.ts` (edited) — added `botBlockerDecisionOutcomes`/
  `BotBlockerDecisionOutcomeSchema`, added `outcome` to `DecisionRevisionEnvelopeSchema`, added
  `policy_version_regression`/`invalid_challenge_transition` to `botBlockerErrorCodes`, updated
  the file's top-of-file and envelope doc comments to describe Phase 2's changes instead of
  deferring them.
- `libraries/contracts/src/botblocker-challenge.ts` (new) — challenge lifecycle contracts.
- `libraries/contracts/src/botblocker-policy.ts` (new) — signed-policy payload contracts.
- `libraries/contracts/src/botblocker-clearance.ts` (new) — unsigned site-clearance contract.
- `libraries/contracts/src/botblocker-proofs.ts` (new) — Passport/PaidTokenPass assertion and
  risk-event-batch contracts.
- `libraries/contracts/src/botblocker.test.ts` (edited) — replaced the two Phase 1 envelope
  tests that asserted "no outcome field" with outcome-union boundary tests (accepts `allow`/
  `otp`, rejects five different fabricated third values including an empty string) and envelope
  tests (accepts/rejects with and without `outcome`, rejects a browser-supplied `score`).
- `libraries/contracts/src/botblocker-challenge.test.ts` (new).
- `libraries/contracts/src/botblocker-policy.test.ts` (new).
- `libraries/contracts/src/botblocker-clearance.test.ts` (new).
- `libraries/contracts/src/botblocker-proofs.test.ts` (new).
- `libraries/contracts/src/index.ts` (edited) — added the four new sibling-file exports.

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
  `apps/web`'s Next.js production build and `apps/api`'s test suite): exit code 0, zero failures
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

- `libraries/contracts/src/auth.ts`
- `libraries/contracts/src/projects.ts`
- `libraries/contracts/src/index.test.ts`
- `apps/web/app/signup-modal.tsx`
- `apps/web/app/v1/auth/signup/route.ts`
- `apps/web/app/dashboard/project-card.tsx`
- `docs/AS_BUILT.md`

**Exact files added/changed for Phase 3:**

- `libraries/contracts/src/botblocker-signing.ts` (new)
- `libraries/contracts/src/botblocker-signing.test.ts` (new)
- `libraries/contracts/src/botblocker-clearance.ts`
- `libraries/contracts/src/botblocker-clearance.test.ts`
- `libraries/contracts/src/botblocker-policy.ts`
- `libraries/contracts/src/botblocker-policy.test.ts`
- `libraries/contracts/src/index.ts`
- `libraries/botblocker-signing/package.json` (new)
- `libraries/botblocker-signing/tsconfig.json` (new)
- `libraries/botblocker-signing/src/index.ts` (new)
- `libraries/botblocker-signing/src/index.test.ts` (new)
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
- `apps/api/src/botblocker-replay.ts` passes the existing authenticated ioredis client directly
  to the atomic consumer; TypeScript verifies the production client implements the required
  `SET key value PX ttl NX` interface. Test fakes exist only in test files.

**Exact files added/changed for Phase 4 implementation:**

- `libraries/botblocker-signing/src/key-ring.ts` (new)
- `libraries/botblocker-signing/src/key-ring.test.ts` (new)
- `libraries/botblocker-signing/src/replay.ts` (new)
- `libraries/botblocker-signing/src/replay.test.ts` (new)
- `libraries/botblocker-signing/src/index.ts`
- `libraries/botblocker-signing/src/index.test.ts`
- `apps/api/src/botblocker-config.ts` (new)
- `apps/api/src/botblocker-config.test.ts` (new)
- `apps/api/src/botblocker-replay.ts` (new)
- `apps/api/src/config.ts`
- `apps/api/src/config.test.ts`
- `apps/api/package.json`
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

- `libraries/contracts/src/botblocker-site.ts` (new)
- `libraries/contracts/src/botblocker-site.test.ts` (new)
- `libraries/contracts/src/index.ts`
- `apps/api/src/botblocker-site-persistence.ts` (new)
- `apps/api/src/botblocker-site-service.ts` (new)
- `apps/api/src/botblocker-site-service.test.ts` (new)
- `apps/api/src/persistence.ts`
- `apps/web/app/v1/projects/[projectId]/botblocker/route.ts` (new)
- `apps/web/lib/server-context.ts`
- `apps/web/app/dashboard/botblocker-panel.tsx` (new)
- `apps/web/app/dashboard/project-card.tsx`
- `apps/web/app/dashboard.css`
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
- `npm run build -w @powerotp/api` and `npm run typecheck -w @powerotp/web`: passed.
- `npm run verify`: exit code 0. The full monorepo build, lint/typecheck, and test sequence
  passed, including the Next.js production build.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: clean.

**Manual/migration/deployment steps.** No one-off MongoDB migration is needed. On a future
normal application startup, `ensureIndexes()` creates the two `botblockerSites` indexes and
existing projects receive their disabled default row on first authorized GET/PATCH. Nothing
was deployed and no production configuration was changed in this phase. Deployment remains
insufficient to activate BotBlocker because no customer-traffic consumer exists.

**Findings and unresolved risks.**

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

- `libraries/contracts/src/botblocker-persistence.ts` (new)
- `libraries/contracts/src/botblocker-persistence.test.ts` (new)
- `libraries/contracts/src/index.ts`
- `apps/api/src/botblocker-intelligence-persistence.ts` (new)
- `apps/api/src/botblocker-intelligence-persistence.test.ts` (new)
- `apps/api/src/persistence.ts`
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
- `npm run verify`: passed after removing only the generated `apps/web/.next` directory and
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

- `libraries/contracts/src/botblocker-policy-persistence.ts` (new)
- `libraries/contracts/src/botblocker-policy-persistence.test.ts` (new)
- `libraries/contracts/src/index.ts`
- `apps/api/src/botblocker-policy-persistence.ts` (new)
- `apps/api/src/botblocker-policy-persistence.test.ts` (new)
- `apps/api/src/botblocker-policy-service.ts` (new)
- `apps/api/src/botblocker-policy-service.test.ts` (new)
- `apps/api/src/botblocker-site-persistence.ts`
- `apps/api/src/persistence.ts`
- `apps/web/lib/botblocker-policy-http.ts` (new)
- `apps/web/lib/http-etag.ts` (new)
- `apps/web/lib/server-context.ts`
- `apps/web/app/v1/botblocker/policy/[siteId]/route.ts` (new)
- `apps/web/app/v1/botblocker/policy/[siteId]/route.test.ts` (new)
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
- `@powerotp/web`: 5 tests / 2 suites, 0 failures. New tests cover exact/weak/list/wildcard ETag
  matching and the `200`/`304`/`404`/`503` bodies and cache headers.
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

- The service-level publication primitive is intentionally not an HTTP surface. Phase 8 must
  add authenticated, authorized, audited admin release-management routes without accepting
  caller signatures or allowing in-place release edits.
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

**Phase 8 prerequisites.** Build the remaining central API surface and authenticated policy
release administration against these contracts and persistence boundaries. Reuse the existing
correlation-ID/error patterns; require customer/project/site ownership or platform-admin
authorization as applicable; return typed unavailable responses for unbacked services; never
fabricate decisions, scores, challenge success, entitlements, or release signatures. Phase 8
must not activate customer traffic, implement adapters/sensors/scoring/real ingestion, expose
private signing material, reuse OTP secrets, or begin CleanDataPage work.

## 2026-08-13 — Phase 8: Complete central API surface

**Outcome.** Complete in code and intentionally inactive in production. The permanent runtime
origin is `https://verify.powerotp.com/v1/botblocker/*`; DigitalOcean remains the origin until
Phase 27 can move that same hostname to Cloudflare without changing adapter paths. Platform
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

- Contracts: `libraries/contracts/src/botblocker.ts`,
  `libraries/contracts/src/botblocker-api-runtime.ts`,
  `libraries/contracts/src/botblocker-api-runtime.test.ts`,
  `libraries/contracts/src/botblocker-api-control.ts`,
  `libraries/contracts/src/botblocker-api-control.test.ts`, and
  `libraries/contracts/src/index.ts`.
- API: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`,
  `apps/api/src/persistence.ts`, `apps/api/src/botblocker-errors.ts`,
  `apps/api/src/botblocker-site-credential-persistence.ts`,
  `apps/api/src/botblocker-site-credential-persistence.test.ts`,
  `apps/api/src/botblocker-site-credential-service.ts`,
  `apps/api/src/botblocker-site-credential-service.test.ts`,
  `apps/api/src/botblocker-runtime-security.ts`,
  `apps/api/src/botblocker-runtime-security.test.ts`,
  `apps/api/src/botblocker-intelligence-persistence.ts`,
  `apps/api/src/botblocker-operations-service.ts`,
  `apps/api/src/botblocker-operations-service.test.ts`,
  `apps/api/src/botblocker-policy-persistence.ts`, and
  `apps/api/src/botblocker-policy-control-service.ts`.
- Shared web wiring: `apps/web/lib/api-errors.ts`,
  `apps/web/lib/botblocker-http.ts`, `apps/web/lib/botblocker-responses.ts`,
  and `apps/web/lib/server-context.ts`.
- Runtime/customer routes:
  `apps/web/app/v1/botblocker/rapid-auth/route.ts`,
  `apps/web/app/v1/botblocker/browser-assessment/route.ts`,
  `apps/web/app/v1/botblocker/risk-events/route.ts`,
  `apps/web/app/v1/botblocker/challenges/route.ts`,
  `apps/web/app/v1/botblocker/challenges/[challengeId]/route.ts`,
  `apps/web/app/v1/botblocker/challenges/[challengeId]/complete/route.ts`,
  `apps/web/app/v1/botblocker/passports/register/route.ts`,
  `apps/web/app/v1/botblocker/passports/assert/route.ts`,
  `apps/web/app/v1/botblocker/paid-passes/assert/route.ts`,
  `apps/web/app/v1/botblocker/agent/entitlements/route.ts`,
  `apps/web/app/v1/projects/[projectId]/botblocker/visitors/route.ts`, and
  `apps/web/app/v1/projects/[projectId]/botblocker/rotate-site-credential/route.ts`.
- Operator routes: `apps/web/app/v1/control/botblocker/rapid-list/route.ts`,
  `apps/web/app/v1/control/botblocker/decision-traces/[gateSessionId]/route.ts`,
  `apps/web/app/v1/control/botblocker/health/route.ts`, and
  `apps/web/app/v1/control/botblocker/policy-releases/route.ts`.
- Web tests: `apps/web/app/v1/botblocker/phase8-http.test.ts`.
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
  operationally only when `verify.powerotp.com` is routed.
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
- `@powerotp/web`: typecheck passed; 8 tests / 3 suites, 0 failures. New tests cover strict
  unavailable/authentication/replay/rate-limit response bodies.
- `npm run verify`: passed, including the Next.js production build and every new
  `/v1/botblocker/*`, `/v1/control/botblocker/*`, visitor, and credential-rotation route. No
  OneDrive retry was needed.
- `npm audit`: 0 vulnerabilities. `git diff --check`: clean.

**Manual/migration/deployment steps.** Normal startup creates the new indexes; there is no
one-off migration and no seeded record. Before any future activation, an operator must
independently configure the credential hash secret/runtime origin, route
`verify.powerotp.com` to the application, configure a real BotBlocker signing key, rotate a
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

- Contracts: `libraries/contracts/src/botblocker.ts` and
  `libraries/contracts/src/botblocker.test.ts`.
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
comment). The user clarified that POWEROTP controls recommended website state through an
additive plugin protocol. Middleware collects trusted data and communicates server-to-server
using the customer's site credential for first RapidAuth/session contact and narrow
server-held visitor tokens thereafter; browser SDK state tells the installed customer plugin
whether POWEROTP recommends restricted/withheld, full-access, or OTP mode. Customer code is the
enforcement point because POWEROTP cannot rewrite its application.

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
- The user confirmed that this was the wrong product boundary. POWEROTP controls the
  recommendation, and supported customer plugin code is expected to enforce it; any pre-content
  gate remains customer-authored conditional rendering around the SDK. POWEROTP cannot
  technically force compliance or retract customer content already delivered.
- Historical Phase 0–13 entries remain unchanged as evidence of what was actually specified
  and built. This entry supersedes their product-intent claims without falsifying history.

**Exact files changed.**

- `docs/POWEROTP_BOTBLOCKER_PLAN.md`: rewrote Purpose, invariants, system flow, Gate Adapter,
  browser SDK/OTP opener, initial adapters, and failure/security rules around customer-owned
  rendering and the single server-selected OTP launch.
- `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`: corrected the end goal and Phase 0/9/19/20
  descriptions; inserted corrective Phases 13A–13D without renumbering 14–31.
- `docs/THREAT_MODEL.md`: replaced the optimistic enforcement claim with the plugin-instruction/
  customer-enforcement boundary and explicit OTP launch authority.
- `docs/POWEROTP_BOTBLOCKER_SOC2_ISO27001_CONTROL_MATRIX.md`: records the identified Phase 9–13
  implementation gap without claiming the corrective code exists.
- `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`: current-status clarification and this entry.
- `libraries/contracts/src/botblocker.ts`: corrected the timeout comment/reference; no schema,
  type, constant, wire shape, or runtime behavior changed.

**Locked product semantics.**

- Middleware attaches trusted framework-native request/session state, communicates
  server-to-server with the site credential for first contact and narrow server-held visitor
  tokens thereafter, and leaves customer handlers, bodies, streams, routes, SSR, and responses
  untouched.
- The browser SDK collects only approved evidence and publishes recommendation snapshots.
  Supported customer plugin code maps `checking` to restricted/withheld; verified `allow`,
  timeout fail-open, or unavailable fail-open to full access; verified `otp` to restricted plus
  call OTP; and authoritative OTP success to full access.
- Customers wanting pre-content gating must defer their own SSR/data fetch/render while state
  is `checking`. POWEROTP controls the instruction but cannot technically force customer code
  to comply.
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

**Tests and verification.** No runtime code or contract changed, so no runtime suite was
required for this specification-only phase. Cross-document/source-comment searches confirmed
no current product specification still claims that POWEROTP automatically controls customer
rendering. Historical as-built descriptions intentionally retain those terms.
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
