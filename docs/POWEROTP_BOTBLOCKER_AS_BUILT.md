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

BotBlocker is **not active for any real customer**. No BotBlocker middleware, RapidAuth
service, risk scoring, Passport, PaidTokenPass, or BotBlocker persistence exists in production
code yet. The only bot-related code that exists today is documented in
[`AS_BUILT.md`](AS_BUILT.md): the hosted-widget bot-signal honeypot
(`apps/api/src/bot-signal-service.ts`, `GET
/v1/modal-sessions/{sessionId}/ai-index-summary`) and the customer-facing "Visitors" dashboard
panel/`GET /v1/projects/{projectId}/visitors` route, whose "Threat score" column is
deliberately scaffolding that always reads "Coming soon." `libraries/contracts` exports the
Phase 1–3 BotBlocker wire and signed-artifact contracts. The server-only
`@powerotp/botblocker-signing` workspace implements canonical Ed25519 signing/verification,
active/previous key lifecycle, bounded skew, and atomic Valkey nonce consumption (Phases 3–4).
The API validates optional independent key configuration and exposes a production Valkey
adapter, but no route, middleware, wrapper, policy publisher, risk engine, customer activation,
or persistence beyond bounded-TTL replay markers consumes any of it yet.

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
