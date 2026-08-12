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
deliberately scaffolding that always reads "Coming soon."

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
