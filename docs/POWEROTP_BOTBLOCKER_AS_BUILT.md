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
deliberately scaffolding that always reads "Coming soon." As of Phase 1, one library
(`libraries/contracts/src/botblocker.ts`) exports versioned protocol/timeout/request-context/
browser-evidence/behavior-report/decision-envelope/error contracts, but nothing yet imports or
calls them — no route, middleware, or wrapper exists.

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
