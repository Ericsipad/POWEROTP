# POWEROTP Sign-In as a Service — AS-BUILT record

Append-only implementation record for
[`POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`](POWEROTP_SIGNIN_AD_SERVICE_PLAN.md).

This file records what has actually been completed and verified. The plan describes intended work.
Do not mark a phase/step implemented, deployed, remote-green, or certified without evidence.

## Phase/step index

- Planning baseline — 2026-08-21 00:42 UTC
- Latest planning direction — 2026-08-21 02:46 UTC, immutable email custody modes
- Latest canonical completion — 2026-08-21 05:44 UTC, polling/realms/mobile/PWA roadmap
- Latest coherence correction — 2026-08-21 05:55 UTC
- Final review correction — 2026-08-21 06:00 UTC, terminal-result TTL
- P0-S1 — completed 2026-08-21 19:09 UTC, hosted-auth glossary and executable boundaries
- P0-S2 — completed 2026-08-21 19:26 UTC, data governance and trust boundaries
- P0-S3 — completed 2026-08-21 19:40 UTC, consent, vendor gates, and claims policy
- P0-S4 — completed 2026-08-21 19:59 UTC, hosted-auth threat model
- P1-S1 — completed 2026-08-21 20:39 UTC, purpose-specific hosted-auth identifiers
- P1-S2 — completed 2026-08-21 21:02 UTC, hosted-auth state machines
- P1-S3 — completed 2026-08-21 21:30 UTC, provider and balance-operation interfaces
- P1-S4 — completed 2026-08-21 22:09 UTC, protocol/TTL/idempotency/PWA route contracts
- P2-S1 — completed 2026-08-21 22:40 UTC, production Supabase identity schema and RLS
- P2-S1 TLS correction — 2026-08-21 22:56 UTC, verified pooler login and CA trust
- P2-S2 — completed 2026-08-22 00:49 UTC, MongoDB hot auth-request repository
- P2-S2 timeout correction — 2026-08-22 01:02 UTC, fixed ten-minute active ceremony
- P2-S3 — completed 2026-08-22 01:17 UTC, durable redacted retention before publication
- P2-S4 — completed 2026-08-22 01:28 UTC, durable hosted-auth supporting schemas
- P2-S5 — completed 2026-08-22 01:38 UTC, per-person envelope encryption and KMS
- P2-S6 — completed 2026-08-22 01:48 UTC, KMS-backed pairwise and lookup derivation rotation
- P2-S7 — completed 2026-08-22 02:07 UTC, person/profile/contact creation saga and compensation
- P2-S8 — completed 2026-08-22 02:19 UTC, pending identity reconciliation and orphan detection
- P2-S9 — completed 2026-08-22 02:30 UTC, retention and provider-cleanup deletion orchestration
- P2-S10 — completed 2026-08-22 03:00 UTC, crypto-shredding and restore replay
- P3-S0 — completed 2026-08-22 03:32 UTC, hosted-auth DNS/TLS/routing/deployment isolation
- P3-S0 proxy correction — 2026-08-22 03:44 UTC, authenticated public-realm handoff
- P3-S0 runtime correction — 2026-08-22 03:51 UTC, single realm authority across runtimes
- P3-S1 through P15-S6 — not started

Update this index after every execution step with a link to that step's latest timestamped entry.

## Entry format

Use:

`## YYYY-MM-DD HH:mm UTC — P{phase}-S{step}: <title>`

Every implementation entry must record:

- Status and scope
- Evidence and affected files
- Implemented contracts/routes/data/UI
- Findings and directional changes with rationale
- Security, privacy, compatibility, and migration impact
- Intentional deviations and known limitations
- Focused verification commands and results
- Commit, push, and remote-check status
- Exact next dependency step

Never rewrite or silently remove an older finding or decision. Add a new timestamped correction.

## 2026-08-21 00:42 UTC — Planning baseline established

Status: documentation design completed; implementation has not started.

Recorded direction:

- Hosted sign-up/sign-in uses top-level POWEROTP redirects and one private hosted-auth identity with
  multiple discoverable passkeys.
- Clients receive only stable project-scoped IDs and never receive PII, encrypted PII, decryption
  keys, WebAuthn material, Didit evidence, or global identity IDs.
- Hosted-auth identity remains separate from Passport, with only a deferred future linkage.
- Supabase is the authoritative encrypted identity/PII store; MongoDB stores operational records and
  wrapped DEKs; KMS/HSM retains usable key authority.
- Recovery is authorized centrally by POWEROTP. Clients may initiate but cannot authorize it.
- Native WebAuthn hybrid transport supplies cross-device QR.
- Template 1 is the only MVP template, with separate sign-up/sign-in entities, six alternating
  image/rich-text rows, six independently toggleable collapsing ad positions, and item-level edits.
- Images are validated, re-encoded, stored on POWEROTP's Bunny-backed CDN, and atomically replaced
  before old assets are deleted.
- The existing POWEROTP MCP remains public, anonymous, credential-free, project-unaware, and
  read-only. It supplies hosted-auth instructions/examples only; project management uses the normal
  authenticated project API.
- Implementation is divided into P0-S1 through P14-S4 execution steps, each scoped to no more than
  20% of a fresh session's expected context.

Evidence:

- [`POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`](POWEROTP_SIGNIN_AD_SERVICE_PLAN.md)
- [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md)
- [`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`](PASSPORT_BUSINESS_AND_LEGAL_PLAN.md)

Verification:

- Documentation-only planning update; no build, test, deployment, commit, push, or remote CI check
  was performed.

Next step:

- P0-S1 — lock the product, relying-party origin, identity, Passport, and BotBlocker boundaries in
  executable contracts/documentation before implementation.

## 2026-08-21 02:46 UTC — Planning direction: immutable email custody modes

Status: canonical plan updated; implementation has not started.

Directional changes:

- Every project now requires immutable `identityDataMode` at creation:
  - `didit_pii`: Didit is the email/contact custodian and handles contact email authentication.
  - `powerotp_pii`: POWEROTP encrypts the email in Supabase and uses its existing Brevo service for
    sign-up verification, email-code login, notifications, and recovery.
- Changing custody mode requires a new project. The mode cannot be edited in place.
- Both modes use the same POWEROTP identity, WebAuthn credentials, authorization-code exchange, and
  project-scoped client IDs. WebAuthn does not call Didit or Brevo.
- Didit identity linkage is now exact:
  - POWEROTP generates opaque `potpDiditId` and sends it as `vendor_data`.
  - `POST /v3/users/create/` returns stable `diditInternalId`.
  - POWEROTP stores `hostedIdentityId → potpDiditId → diditInternalId`.
- Sign-up first attempts POWEROTP session/passkey recognition, then keyed email lookup, before
  creating an identity or Didit User.
- Valid age/KYC claims are reusable across client projects while current. Biometric authentication
  remains a fresh liveness/face-match event.
- Didit process-and-purge applies when biometric authentication is not enabled. Enabling biometric
  authentication intentionally retains an approved face on the persistent Didit User under its own
  consent and retention policy.
- The Didit phase now includes explicit configuration, permanent User mapping, separate capability
  adapters, reusable-claim charging, and media-retention enforcement.

Evidence:

- Didit Management API documents `POST /v3/users/create/`, caller-supplied `vendor_data`, and returned
  stable `didit_internal_id`.
- Didit User documentation records persistent approved emails/phones, feature status, DOB, and
  biometric references under the User entity.
- Didit biometric-authentication documentation resolves an approved stored face by `vendor_data`
  and performs a fresh liveness/face-match session.
- [`POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`](POWEROTP_SIGNIN_AD_SERVICE_PLAN.md)

Verification:

- Documentation-only planning update; no build, test, environment change, deployment, commit, push,
  or remote CI check was performed.

Next step:

- P0-S1 remains the first implementation step.

## 2026-08-21 06:00 UTC — Final review correction: terminal-result TTL

Status: final material contradiction found by read-only review and corrected.

Correction:

- Every terminal auth-request outcome (`succeeded`, `failed`, `canceled`, or `expired`) is
  idempotently pollable for exactly three minutes after `completedAt`.
- The durable redacted retention record is written before any terminal poll result becomes visible.
- The runtime record, poll-token hash, and sensitive result payload are deleted after that window.

Verification:

- Final read-only review found no other material blocker in the requested areas.
- Documentation-only work; no build, runtime test, environment change, deployment, commit, push, or
  remote CI check was performed.

Next step:

- P0-S1 remains the first implementation step.

## 2026-08-21 05:44 UTC — Planning direction: polling, realm profiles, mobile, and PWA

Status: canonical plan completed and dependency roadmap reordered; implementation has not started.

Directional changes:

- Replaced authorization-code exchange with server polling:
  - Project backend receives shown-once `pollToken` and keeps it out of the browser.
  - Client selects active request lifetime within 5 minutes–24 hours.
  - Successful result is idempotently pollable for exactly three minutes.
  - Runtime request/token/result are then deleted while a separate redacted retention row remains.
- Added separate runtime and durable retention data stores so polling can remain minimal/portable
  without losing audit, billing, or support evidence.
- Defined one private person root with two realm-isolated authentication profiles:
  - `authx.powerotp.com` for `powerotp_pii`.
  - `authz.powerotp.com` for `didit_pii`.
  - Profiles have separate RP IDs, user handles, passkeys, and cookies while sharing person-level
    Didit mapping and reusable age/KYC claims.
- Removed cross-project POWEROTP SSO. Every client auth request requires fresh proof. Clients own
  their sessions, refresh tokens, expiry, and logout.
- Recovery is a signin-state branch. Recovery proof must complete before a one-time passkey
  registration grant is issued.
- Added native WebAuthn hybrid QR and a separate single-use POWEROTP mobile handoff QR.
- Added the complete separate Template 1 mobile renderer and retained shared security/state logic.
- Added exact signup/signin/failure/recovery/restart project URLs.
- Added simple prepaid balance checks linked to existing Brevo/SMS/voice/Didit interactions; no new
  spend-control subsystem.
- Moved Didit contact/User/webhook integration before signup and split optional age/KYC/liveness/
  biometric assurance into later steps.
- Reordered Phases 0–14 by dependency and added Phase 15 as the final installable PWA/Web Push phase.
  Earlier browser phases include PWA-safe routing and strict no-cache/service-worker boundaries.

Verification:

- Documentation-only planning update; no build, test, environment change, deployment, commit, push,
  or remote CI check was performed.

Next step:

- P0-S1 — lock the glossary, product boundaries, person/profile model, RP realms, and separation from
  Passport/BotBlocker before implementation.

## 2026-08-21 05:55 UTC — Planning correction after completeness review

Status: documentation reviewed and corrected; implementation has not started.

This entry explicitly supersedes older planning statements without deleting history:

- Authorization-code exchange is retracted. The canonical client contract is authenticated polling
  with a shown-once server-only poll token and a three-minute terminal-result window.
- Shared WebAuthn credentials across custody modes are retracted. `authx` and `authz` profiles have
  separate RP IDs, user handles, credentials, and cookies under one private person root.
- `hostedIdentityId` is replaced by `hostedPersonIdentityId`.
- Signup does not authenticate from a prior POWEROTP identity session. It performs fresh
  realm-specific WebAuthn/contact proof; remembered-account cookies are UI-only.
- Runtime request data and durable retained audit data are separate. The hot runtime store is a
  dedicated portable repository; the retained redacted record survives hot-result deletion.
- The roadmap extends through P15-S6, with the PWA as the last phase.

Completeness corrections added:

- Exact browser routing for signup/signin/failure/recovery/restart and UX-only return hints.
- Terminal poll response contracts and three-minute purge for success/failure/cancel/expiry.
- Deterministic cross-mode profile linking requiring target contact proof plus existing-profile proof;
  email equality alone never merges person roots.
- Mode-specific email/SMS/voice contact alternatives, credential-management grants, and pending
  credential rollback after failed required assurance.
- Supabase, authx/authz, Bunny, Didit, KMS, and deployment prerequisites in dependency order.
- Didit age/KYC/liveness adapters moved before signup; biometric authentication remains later.
- Recovery-code issuance, mobile handoff, exact recovery return routing, and post-proof passkey
  registration.
- POWEROTP evergreen content, education carousel, manually reviewed MVP creative serving, and
  fill-sensitive ad slots.
- Baseline lookup/recovery limits, secret redaction, CSP, and service-worker no-cache rules before
  public auth flows.
- Public MCP guidance moved after recovery/assurance APIs are complete.

Verification:

- Two independent read-only plan reviews were completed and their actionable findings were applied.
- Documentation-only work; no build, runtime test, environment change, deployment, commit, push, or
  remote CI check was performed.

Next step:

- P0-S1 remains the first implementation step.

## 2026-08-21 19:09 UTC — P0-S1: Hosted-auth glossary and product boundaries

Status and scope:

- P0-S1 is complete. This step implemented only the hosted-auth glossary, product separation,
  private person-root/auth-profile model, and exact `authx`/`authz` realm isolation.
- Identifier formats, persistence, request state machines, provider custody details, and browser/API
  flows remain assigned to later steps.

Evidence and implemented contracts:

- Added `hosted-auth-boundaries.ts` to `@powerotp/contracts` with strict Zod contracts for:
  - immutable `powerotp_pii` and `didit_pii` mode names;
  - exact mode-to-origin-to-RP-ID mappings;
  - one private person root with no more than one profile per mode;
  - realm-profile isolation of passkeys, user handles, and cookies;
  - project-scoped client identity, fresh proof per request, no cross-client SSO, and explicit
    Passport/BotBlocker separation.
- Added reject-by-construction tests covering cross-realm combinations, duplicate profiles, shared
  profile material, global client identity, SSO, Passport/BotBlocker conflation, and undeclared
  sensitive exposure fields.
- Added the normative glossary and boundary document and linked it from the canonical plan.

Affected files:

- `backend/packages/contracts/src/hosted-auth-boundaries.ts`
- `backend/packages/contracts/src/hosted-auth-boundaries.test.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No canonical direction changed. P0-S1 converted the already-locked plan boundaries into named,
  strict executable contracts without pulling later identifier or storage design into this step.
- The existing untracked `instrumentation.ts` duplicate under a removed top-level deployment root
  is byte-identical to the tracked server instrumentation, belongs to no current workspace, and is
  unrelated to hosted auth. It was inspected and intentionally left untouched/uncommitted.

Security, privacy, compatibility, and migration impact:

- Invalid cross-realm RP/origin combinations and shared realm-profile credential material now fail
  schema validation.
- The product manifest cannot validate if it claims cross-client SSO, global client identity,
  Passport identity equivalence, or BotBlocker service equivalence.
- This additive contracts-package change has no database, route, environment, deployment, PWA,
  Passport, or BotBlocker migration impact.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P0-S1 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P0-S2 — lock data classification, contact custody, trust boundaries, abuse cases, retention, and
  deletion owners without beginning P0-S3 consent/vendor wording or P0-S4 threat-model changes.

## 2026-08-21 19:14 UTC — P0-S1 remote verification correction

Finding and correction:

- The first pushed Verify workflow failed because the P0-S1 AS-BUILT evidence named an intentionally
  untracked file using a removed deployment-root path. The repository's hostname/separation guard
  correctly rejects that stale path text anywhere in tracked files.
- Reworded the evidence without the removed path. The untracked file itself remains untouched and
  excluded from both P0-S1 commits.

Focused verification:

- `node --import tsx --test integration-tests/post-separation-hostnames.test.ts` — passed.

Commit, push, and remote check:

- The correction is included in a P0-S1 follow-up commit. Final push and replacement Verify result
  are reported in the post-push session handoff.

Next step:

- P0-S2 remains unchanged.

## 2026-08-21 19:22 UTC — P0-S2: Hosted-auth data governance and trust boundaries

Status and scope:

- P0-S2 is complete. This step locked hosted-auth data classification, contact custody, trust
  boundaries, abuse cases, retention behavior, and deletion execution ownership.
- P0-S3 consent purposes/vendor wording and P0-S4 `THREAT_MODEL.md` changes were not started.
  Passport and BotBlocker plans and behavior were not modified.

Evidence and implemented contracts:

- Added `hosted-auth-data-classes.ts` and `hosted-auth-data-governance.ts` to
  `@powerotp/contracts` with strict canonical contracts for 18 identity, contact, provider,
  consent-evidence, credential, request, audit, key, project-content, security-event, and client
  mapping data classes. Every class names its controller, custodian/store, applicable custody mode,
  client exposure, retention rule, and deletion owner.
- Locked mode-specific recoverable contact custody:
  - `powerotp_pii` stores encrypted contact in POWEROTP Supabase and authenticates through
    purpose-separated POWEROTP providers.
  - `didit_pii` stores recoverable contact only on the Didit User and authenticates through Didit.
  - Cross-mode provider fallback is rejected.
- Locked the client/browser/store/KMS/provider/support trust boundary and the complete canonical set
  of cross-project, redirect, cross-realm, reset, enumeration/pumping, token, callback, compromise,
  privileged-support, logging, and deletion-orphan abuse cases.
- Added reject-by-construction tests for omitted/duplicated/reclassified data, sensitive client
  exposure, cross-mode custody, provider fallback, cross-project/cross-realm access, client/global
  reset authority, database-only decryption, privileged support mutation, and incomplete abuse sets.
- Added the normative data-governance document with deletion-saga ownership and linked it from the
  canonical plan and P0-S1 boundary document.

Affected files:

- `backend/packages/contracts/src/hosted-auth-data-governance.ts`
- `backend/packages/contracts/src/hosted-auth-data-governance.test.ts`
- `backend/packages/contracts/src/hosted-auth-data-classes.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No P0-S1 product or identity direction changed.
- Final calendar durations remain counsel-approved policy inputs as already deferred by the
  canonical plan. P0-S2 nevertheless forbids indefinite-by-default retention by assigning every
  class a lifecycle/policy anchor and one deletion executor.
- Didit storage custody does not transfer POWEROTP's controller responsibility. Provider deletion
  is owned by the Didit adapter and reconciled by POWEROTP's deletion orchestrator.
- The runtime database's exact terminal-result retention remains three minutes. Redacted durable
  audit evidence is a separate data class and cannot contain poll/browser secrets, PII, provider
  secrets, or the complete result.

Security, privacy, compatibility, and migration impact:

- Clients remain limited to their project-scoped user ID and explicitly authorized outcomes.
  They gain no PII/global identifier exposure or identity recovery/deletion/credential authority.
- Database-only compromise is explicitly outside the decryption trust boundary; runtime compromise
  remains a bounded threat rather than being treated as harmless.
- This additive contracts/documentation step has no database migration, route, environment,
  deployment, Passport, BotBlocker, or vendor-configuration impact.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- No full-monorepo verification was run because this step touched only the contracts package and
  documentation.

Commit, push, and remote check:

- The coherent P0-S2 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P0-S3 — lock consent purposes, certification wording, Didit/vendor gates, and prohibited claims
  without beginning P0-S4 hosted-auth threat-model changes.

## 2026-08-21 19:26 UTC — P0-S2 remote verification correction

Finding and correction:

- The first pushed P0-S2 Verify run failed during TypeScript verification because the canonical
  data-class map inferred its keys as a literal union while strict schema parsing exposes an
  untrusted `dataClass` lookup as `string`.
- Widened only the internal map lookup key to `string`; canonical values, strict validation,
  completeness checks, and every P0-S2 boundary remain unchanged.

Focused verification:

- `npm run typecheck -w @powerotp/contracts` — passed.

Commit, push, and remote check:

- The correction is included in a P0-S2 follow-up commit. Final push and replacement Verify result
  are reported in the post-push session handoff.

Next step:

- P0-S3 remains unchanged.

## 2026-08-21 19:40 UTC — P0-S3: Hosted-auth consent, vendor gates, and claims policy

Status and scope:

- P0-S3 is complete. This step locked hosted-auth consent purposes and evidence, Didit production
  activation gates, approved certification wording, and prohibited claims.
- P0-S4 `THREAT_MODEL.md` changes were not started. P0-S1/P0-S2 boundaries were preserved, and
  Passport and BotBlocker plans were not modified.

Evidence and implemented contracts:

- Added strict `@powerotp/contracts` schemas for six separately recorded consent purposes: core
  hosted identity/authentication, `didit_pii` contact custody, age assurance, KYC assurance,
  liveness/face enrollment, and fresh biometric authentication with retained face.
- Required exact text/policy versions, purpose, named-provider disclosure, locale, timestamp,
  affirmative action, and withdrawal/deletion path. Bundled, preselected, and after-capture consent
  are rejected.
- Locked eight Didit production gates covering counsel-approved copy, provider disclosure,
  contractual reuse carve-out, data-processing terms, finite capability retention, written
  model-training opt-out, deletion reconciliation, and vendor exit/replacement.
- Locked the two approved pre-certification statements and ten prohibited claim categories.
- Added reject-by-construction tests for incomplete, reordered, bundled, reclassified, or invented
  purpose/gate/claim sets.

Affected files:

- `backend/packages/contracts/src/hosted-auth-consent-and-vendor-gates.ts`
- `backend/packages/contracts/src/hosted-auth-consent-and-vendor-gates.test.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_CONSENT_AND_VENDOR_GATES.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_PLAN.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No P0-S1/P0-S2 product, identity, custody, storage, or client-exposure direction changed.
- The core hosted-identity purpose explicitly discloses private cross-project reuse while each
  client still receives only its own project-scoped identifier.
- Process-and-purge liveness/face enrollment does not authorize retained-face biometric
  authentication; retained face requires a distinct affirmative purpose.
- Didit credentials or completed adapter code do not satisfy vendor activation gates.
- Final legal copy and calendar retention periods remain counsel-approved inputs.

Security, privacy, compatibility, and migration impact:

- Provider collection cannot precede the applicable recorded affirmative decision, and Didit
  cannot be hidden from the provider disclosure.
- Vendor certificates cannot be represented as POWEROTP certifications. Pseudonymous/keyed data
  cannot be described as anonymous, and verification cannot be guaranteed.
- This additive contracts/documentation step has no database migration, route, environment,
  deployment, provider-credential, Passport, or BotBlocker impact.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- `npm run typecheck -w @powerotp/contracts` — passed.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P0-S3 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P0-S4 — add hosted-auth assets, threats, and mitigations to `docs/THREAT_MODEL.md` without
  beginning Phase 1 contracts.

## 2026-08-21 19:59 UTC — P0-S4: Hosted-auth threat model

Status and scope:

- P0-S4 is complete. This documentation-only step added the hosted-auth protected assets, trust
  boundaries, threats, mitigations, and production gates to the shared threat model.
- No Phase 1 identifier contracts were started. P0-S1 through P0-S3 boundaries were preserved, and
  Passport and BotBlocker plans and behavior were not modified.

Evidence and implemented behavior:

- Added a distinct hosted-auth threat-model section that identifies private identity/profile and
  project-binding data, WebAuthn material, contact/cryptographic/provider data, consent evidence,
  auth-request secrets/results, project content/assets/ads, and service integrity/availability as
  protected assets.
- Recorded seven hosted-auth trust boundaries across client backends, top-level realm browsers,
  hosted request state, separated stores/KMS, mode-specific providers, privileged operators, and
  untrusted tenant/ad content.
- Required mitigations now explicitly cover cross-project correlation/access, open redirects and
  forged browser results, cross-realm credential/cookie use, token/recovery replay, enumeration and
  paid-resource abuse, database-only and runtime compromise, privileged-service abuse, provider
  callbacks/custody/consent/deletion, hosted content/assets/ads, and partial/outage/stale-assurance
  behavior.
- Added explicit product and production gates preserving client-owned sessions, fresh hosted-auth
  proof, BotBlocker/Passport separation, Didit activation evidence, and counsel-owned legal copy and
  calendar retention periods.

Affected files:

- `docs/THREAT_MODEL.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No canonical product, realm, custody, consent, vendor, client-exposure, Passport, or BotBlocker
  direction changed. P0-S4 consolidated the already-locked boundaries into one reviewable
  asset/threat/mitigation model.
- The shared threat-model introduction previously named only the OTP/telephony and BotBlocker
  sections. It now identifies hosted auth as a third separate product section without changing
  either existing product's controls.
- Runtime compromise is explicitly treated as an incident and bounded by minimal hot data,
  least-privilege roles, short result retention, and audit; database separation is not represented
  as protection from a compromised authorized runtime.

Security, privacy, compatibility, and migration impact:

- The threat model now directly covers the Phase 0 acceptance review areas: cross-project linkage,
  open redirect, client-requested global reset, cross-realm credential/cookie replay, database-only
  compromise, runtime compromise, and BotBlocker boundary preservation.
- This step changes no contracts, routes, data stores, UI, environment, credentials, deployments,
  Passport behavior, or BotBlocker behavior and requires no migration.

Focused verification:

- Documentation-only change; per repository verification policy, no build, test, typecheck, or
  full-monorepo verification was run.
- Reviewed the focused diff for consistency with the P0-S1 through P0-S3 normative documents before
  commit.

Commit, push, and remote check:

- The coherent P0-S4 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P1-S1 — add person/profile/project-binding/Didit/auth-request/poll-token identifier schemas while
  preserving all Phase 0 boundaries.

## 2026-08-21 20:39 UTC — P1-S1: Purpose-specific hosted-auth identifiers

Status and scope:

- P1-S1 is complete. This step added only person, profile, project-binding, Didit, auth-request,
  and poll-token identifier contracts.
- P1-S2 state machines were not started. All Phase 0 product, realm, custody, consent, vendor,
  threat, client-exposure, Passport, and BotBlocker boundaries remain unchanged.

Evidence and implemented contracts:

- Added strict, purpose-branded Zod schemas for private `hostedPersonIdentityId`,
  realm-specific `hostedAuthProfileId`, internal `projectIdentityBindingId`, client-visible pairwise
  `projectUserId`, permanent `potpDiditId`, provider-owned `diditInternalId`, public
  `authRequestId`, and shown-once server-only `pollToken`.
- Every POWEROTP-generated value has a distinct fixed prefix and exactly one canonical unpadded
  base64url encoding of 256 random or keyed bits. Schemas reject wrong prefixes, truncation,
  padding, invalid alphabets, and non-canonical trailing bits.
- `diditInternalId` accepts only a lowercase canonical random UUID v4. Zod brands prevent
  cross-purpose assignment at compile time while distinct representations reject substitution at
  runtime.
- Identifier schemas validate representation. Future construction must use a CSPRNG, except
  `projectUserId`, whose 256-bit body comes from the already-specified versioned keyed
  person/project derivation.

Affected files:

- `backend/packages/contracts/src/hosted-auth-identifiers.ts`
- `backend/packages/contracts/src/hosted-auth-identifiers.test.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- P1-S1 names an internal `projectIdentityBindingId` separately from the only binding identifier
  exposed to a client, `projectUserId`. This makes the Phase 0 client-exposure boundary explicit
  rather than permitting one identifier to serve both purposes.
- The plan's generic Didit UUID is narrowed to canonical UUID v4 so provider IDs remain
  non-enumerable and cannot be confused with any prefixed POWEROTP identifier.
- No route, payload, persistence, lifecycle, transition, retry, cancellation, or provider adapter
  behavior was introduced.

Security, privacy, compatibility, and migration impact:

- Runtime prefix separation and compile-time brands reject person/profile/binding/provider/request/
  poll cross-type substitution. The poll credential remains distinct from the non-authorizing
  request correlation ID and is explicitly server-only.
- Private person, profile, internal binding, and Didit identifiers gain no client exposure.
  `projectUserId` remains pairwise and the only identity identifier clients receive.
- This additive contracts change requires no database migration, environment value, provider
  credential, deployment, Passport change, or BotBlocker change.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- `npm run typecheck -w @powerotp/contracts` — passed, including branded-type substitution checks.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P1-S1 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P1-S2 — add auth-request, polling, WebAuthn, contact, recovery, credential-grant, and verification
  state machines without beginning P1-S3 provider interfaces.

## 2026-08-21 21:02 UTC — P1-S2: Hosted-auth state machines

Status and scope:

- P1-S2 is complete. This step added only the auth-request, polling, WebAuthn, contact, recovery,
  credential-management grant, and verification lifecycle contracts.
- P1-S3 provider interfaces, P1-S4 errors/TTLs/idempotency/routes, storage, runtime orchestration,
  Passport, and BotBlocker plans and behavior were not started or modified.

Evidence and implemented contracts:

- Added one pure optimistic-concurrency reducer shared by seven declarative state machines. Every
  command carries the exact project, realm, and flow scope plus an expected machine version.
- A matching immediately repeated event at its prior version is an idempotent duplicate. A
  different stale event is rejected, observation-only polls do not mutate state, and no fresh
  command can mutate a terminal state.
- Auth requests define activation, WebAuthn/contact/recovery branches, proof completion, optional
  assurance, result publication, retries, cancellation, failure, expiry, and four immutable
  terminal outcomes. Recovery is rejected outside a signin flow.
- Polling defines repeatable pending reads, one terminal-result publication, repeatable terminal
  reads, and final purge. The terminal result cannot be replaced or returned to an active state.
- WebAuthn and contact machines consume one submitted proof at a time. Rejected or failed attempts
  retry only by entering a newly issued challenge/operation path; replay cannot revive consumed
  material.
- Recovery requires proof or the explicit delayed branch before issuing a credential grant.
  Credential grants are one-time and bind the project, realm, flow, auth profile, exact
  add/name/revoke action, and fresh-authentication or completed-recovery authorization source.
- Contact and verification scopes use explicit vendor-neutral provider purposes. Verification
  defines fresh operation, decision, retryable failure, satisfied, not-satisfied, indeterminate,
  declined, canceled, and expired paths without introducing a provider adapter.

Affected files:

- `backend/packages/contracts/src/hosted-auth-state-machine-core.ts`
- `backend/packages/contracts/src/hosted-auth-ceremony-scopes.ts`
- `backend/packages/contracts/src/hosted-auth-request-state-machines.ts`
- `backend/packages/contracts/src/hosted-auth-proof-state-machines.ts`
- `backend/packages/contracts/src/hosted-auth-recovery-state-machines.ts`
- `backend/packages/contracts/src/hosted-auth-state-machines.test.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No Phase 0 or P1-S1 boundary changed. Exact realm objects are retained in every machine scope so
  origin, RP ID, and custody mode cannot be independently substituted.
- Machine versions define transition replay/concurrency behavior only. They do not preempt P1-S4's
  API idempotency-key, compatibility-version, TTL, stable-error, or route contracts.
- A retry is a named transition that advances machine version and represents fresh challenge or
  provider-operation material; it never reopens an immutable terminal state.
- Provider purposes are fixed now so later adapters cannot silently change custody or capability,
  but provider request/response interfaces and balance operations remain wholly assigned to P1-S3.

Security, privacy, compatibility, and migration impact:

- Focused reject-by-construction tests cover illegal ordering, terminal mutation, exact replay,
  changed stale events, consumed grant reuse, signup recovery, purpose/flow mismatch, and
  cross-project, cross-realm, cross-flow, cross-profile, and cross-grant-action substitution.
- Client exposure remains limited to the P1-S1 project-scoped identifier contract. No PII, global
  identity, credential material, provider evidence, API key, poll token, or new client session
  contract was added.
- This additive contracts step requires no database migration, environment value, provider
  credential, deployment, Passport change, or BotBlocker change.

Intentional limits and deviations:

- No deviation from P1-S2 was made. The contracts intentionally do not assign calendar TTLs,
  stable failure reasons, HTTP routes, provider payloads, persistence, or runtime side effects;
  those belong to later dependency steps.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- `npm run typecheck -w @powerotp/contracts` — passed.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P1-S2 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P1-S3 — add vendor-neutral email, phone, and Didit interfaces plus the balance-operation contract
  while preserving these state, scope, custody, consent, and identifier boundaries.

## 2026-08-21 21:30 UTC — P1-S3: Provider and balance-operation interfaces

Status and scope:

- P1-S3 is complete. This step added only vendor-neutral hosted-auth email, phone, Didit, and
  prepaid-balance operation contracts.
- P1-S4 stable errors, TTLs, API idempotency, compatibility versions, PWA-safe routes, persistence,
  runtime adapters, provider credentials, Passport, and BotBlocker plans and behavior were not
  started or modified.

Evidence and implemented contracts:

- Added strict email and phone challenge/proof schemas and TypeScript provider interfaces. Every
  operation binds the auth request, project, realm, flow, provider purpose, channel, and immutable
  custody mode. `powerotp_pii` accepts only POWEROTP email/SMS/voice adapters; `didit_pii` accepts
  only Didit email/phone adapters.
- Added a normalized Didit interface for idempotent User resolution, verification start, and
  decision reads using the permanent private
  `hostedPersonIdentityId → potpDiditId → diditInternalId` mapping. No provider SDK payload,
  document, selfie, biometric media, raw evidence, credential, or client-facing global identifier
  appears in the contract.
- Provider starts and decisions echo their exact purpose/realm scope and provider-operation
  reference, preventing a successful operation from being substituted across ceremonies.
- Added an atomic `debit_before_provider` balance-operation contract over the existing prepaid
  ledger boundary. It requires a positive configured USD amount, exact project/auth-request scope,
  and a custody/purpose-compatible billable method before paid provider work. Its only outcomes are
  a linked balance transaction or `insufficient_balance`; WebAuthn has no billable method.

Affected files:

- `backend/packages/contracts/src/hosted-auth-provider-interfaces.ts`
- `backend/packages/contracts/src/hosted-auth-provider-interfaces.test.ts`
- `backend/packages/contracts/src/hosted-auth-balance-operation.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No Phase 0, P1-S1, or P1-S2 boundary changed. Provider results carry normalized internal
  references and minimal evidence references only; later adapters own vendor payload translation.
- The balance contract uses the existing append-only prepaid ledger and deliberately introduces no
  reservation store, spend-limit subsystem, route, or API idempotency contract. P1-S4 retains
  ownership of public idempotency and stable errors.
- Provider-purpose and custody checks apply to both debit requests and results, so a valid charge
  cannot be relabeled for another method, project, realm, or capability.

Security, privacy, compatibility, and migration impact:

- Cross-mode contact fallback, channel substitution, project substitution, verification-purpose
  substitution, zero-cost paid operations, and undeclared/raw provider fields fail strict schema
  validation.
- Recoverable contact values occur only in the internal adapter request boundary. Provider results
  contain no contact value or raw provider evidence, and no contract expands client exposure.
- This additive contracts step requires no database migration, environment value, provider
  credential, deployment, Passport change, or BotBlocker change.

Intentional limits and deviations:

- No deviation from P1-S3 was made. Concrete Brevo/SMS/voice/Didit adapters, callback verification,
  persistence, charge execution, retries, reconciliation, and routes remain assigned to later
  dependency steps.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed after the final contract changes.
- `npm run typecheck -w @powerotp/contracts` — passed after the final contract changes.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P1-S3 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P1-S4 — add stable errors, active/result TTLs, API idempotency, compatibility versions, and
  PWA-safe route contracts without beginning Phase 2 persistence or runtime implementation.

## 2026-08-21 22:09 UTC — P1-S4: Stable hosted-auth protocol and route contracts

Status and scope:

- P1-S4 is complete. This step added only stable errors, active/result TTLs, API idempotency,
  compatibility versions, and PWA-safe route contracts.
- Phase 2 persistence/runtime work, provider adapters and credentials, `.env`, Passport, and
  BotBlocker plans and behavior were not started or modified.

Evidence and implemented contracts:

- Added one exact API compatibility version and one hosted-browser protocol version. Unknown
  versions and enum values fail strict validation.
- Added stable machine-readable API errors and terminal failure reasons covering the canonical
  project, service, return URL, request/result, poll-token, idempotency, verification, signup,
  balance, recovery-delay, content-conflict, authentication, and rate-limit cases.
- Locked active request lifetime to a client-selected 300–86,400 seconds with a 1,800-second
  default. Every terminal result expires exactly 180 seconds after `completedAt`; the exact expiry
  boundary is unavailable.
- Added strict idempotency claims bound to compatibility version, key, operation, exact
  project/realm/flow scope, and lowercase SHA-256 request hash. Exact replay is repeatable; changed
  payload or scope returns `idempotency_conflict`.
- Added a no-store route manifest separating project-backend, hosted-browser, and signed-provider
  authorities. Browser navigation supports ordinary tabs, standalone PWAs, and mobile handoff using
  request-bound server context and configured redirects, never opener, history, or referrer
  authority. Browser return hints remain minimal and non-authoritative.

Affected files:

- `backend/packages/contracts/src/hosted-auth-protocol.ts`
- `backend/packages/contracts/src/hosted-auth-route-contracts.ts`
- `backend/packages/contracts/src/hosted-auth-protocol.test.ts`
- `backend/packages/contracts/src/hosted-auth-route-contracts.test.ts`
- `backend/packages/contracts/src/index.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Findings and directional changes:

- No Phase 0 or P1-S1 through P1-S3 boundary changed. Custody mode remains represented by the exact
  realm object, while flow and project scope remain mandatory in navigation and idempotency claims.
- Compatibility versions describe wire contracts and remain separate from P1-S2 optimistic
  transition versions.
- The contracts describe route/auth/cache/navigation behavior only. They add no route handlers,
  persistence records, TTL indexes, hashing implementation, provider SDK payload, or runtime side
  effect.

Security, privacy, compatibility, and migration impact:

- Hosted browser contracts reject project API keys, poll tokens, client identity results, unknown
  launch surfaces, and undeclared fields. All declared hosted-auth routes are `no_store`.
- This additive contracts step requires no database migration, environment value, provider
  credential, deployment, Passport change, or BotBlocker change.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed.
- `npm run typecheck -w @powerotp/contracts` — passed.
- No full-monorepo verification was run because only the contracts package and documentation were
  changed.

Commit, push, and remote check:

- The coherent P1-S4 commit contains this entry. Its final hash, push confirmation, and one remote
  result check are reported in the post-push session handoff.

Next step:

- P2-S1 — add the per-environment Supabase bootstrap, migration pipeline, connectivity,
  RLS/service roles, and person/profile/credential/contact/consent/verification schema without
  beginning P2-S2 runtime persistence.

## 2026-08-21 22:40 UTC — P2-S1: Production Supabase identity schema and RLS

Status and scope:

- P2-S1 is complete for POWEROTP's actual production-only deployment model. The new production
  Supabase project is named `POTP`, project ref `ozfufuxpdrsfbamopszb`, in `us-east-1`.
- The migration is one version-controlled initial schema applied directly through Supabase's
  migration history. No custom migration pipeline, staging project, development/test database,
  or CI database deployment machinery was introduced.
- Existing MongoDB remains unchanged and continues to own normal application data. P2-S2 hot
  auth-request persistence, TTLs, encrypted poll results, and poll-token hashing were not started.

Evidence and implemented data:

- Added the private `hosted_auth` PostgreSQL schema with seven P2-S1 tables:
  `person_identities`, `auth_profiles`, `webauthn_credentials`,
  `encrypted_identity_attributes`, `contacts`, `consent_records`, and
  `identity_verifications`.
- Database constraints enforce canonical private identifiers, no more than one profile per
  person/custody mode, exact `powerotp_pii`/`authx.powerotp.com` and
  `didit_pii`/`authz.powerotp.com` realm mappings, profile-scoped credentials, paired permanent
  Didit identifiers, and complete encrypted-field groups.
- Recoverable contact attributes can exist only for `powerotp_pii`. A `didit_pii` contact requires
  a Didit reference and cannot reference POWEROTP encrypted contact storage.
- WebAuthn storage contains only public credential material and authenticator metadata. Consent
  stores the exact purpose/version/decision/evidence digest, and verification stores normalized
  outcomes and minimal evidence digests without documents, selfies, media, or raw provider
  evidence.

RLS, roles, connectivity, and client exposure:

- RLS is enabled and forced on every hosted-auth table. `PUBLIC`, `anon`, `authenticated`, and
  Supabase's generic `service_role` have no schema or table access.
- Added the NOLOGIN `potp_hosted_auth_service` and `potp_identity_admin` authorization roles plus
  the dedicated `POTP_backenduser` production login. Its generated password is not stored in git.
- Added optional server-only `HOSTED_AUTH_DATABASE_URL` validation and a bounded PostgreSQL pool
  connectivity check that accepts only the dedicated login with `hosted_auth` schema access.
  Missing configuration fails closed and never falls back to MongoDB.
- The production deployment environment still needs `HOSTED_AUTH_DATABASE_URL` installed manually;
  `.env` and provider credentials were not read or modified.
- No public/client API or route was added. Clients still receive no PII, private/global identity
  ID, credential material, provider reference, consent evidence, or verification evidence.

Findings and directional changes:

- The incoming roadmap wording assumed four Supabase environments and an automated migration
  pipeline. The owner clarified that POWEROTP currently operates one production system and does
  not use staging, development, or test databases. P2-S1 therefore provisions only production and
  keeps one auditable initial migration rather than building unused infrastructure.
- One production Supabase project costs $10/month; the owner explicitly confirmed that recurring
  cost before creation.
- Phase 0 and P1 boundaries remain unchanged. Passport and BotBlocker plans and behavior were not
  modified.

Affected files:

- `supabase/migrations/20260821223500_p2_s1_hosted_identity.sql`
- `backend/packages/api/src/config.ts`
- `backend/packages/api/src/config.test.ts`
- `backend/packages/api/src/hosted-identity-database.ts`
- `backend/packages/api/src/hosted-identity-database.test.ts`
- `backend/packages/api/src/hosted-identity-migration.test.ts`
- `backend/packages/api/package.json`
- `backend/package-lock.json`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Focused verification:

- `npm run test -w @powerotp/api` — passed.
- `npm run typecheck -w @powerotp/api` — passed.
- Production catalog inspection found exactly seven `hosted_auth` tables, all with forced RLS,
  seven internal-only policies, denied public/client/generic-service access, and the expected
  backend membership/schema grant.
- Transactional production checks rejected a wrong-realm profile, a duplicate same-mode profile,
  and a `didit_pii` contact without Didit custody; the transaction was rolled back.

Commit, push, and remote check:

- The coherent P2-S1 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S2 — add only the minimal MongoDB hot auth-request repository, active/terminal TTL behavior,
  encrypted terminal result, and poll-token hashing without beginning durable retention or later
  identity-saga work.

## 2026-08-21 22:56 UTC — P2-S1 production connection TLS correction

- The production Session Pooler connection authenticated successfully as the dedicated
  `POTP_backenduser` and read the empty `hosted_auth.person_identities` table.
- The first strict TLS attempt correctly failed because Node's default CA store does not include
  Supabase's project CA. A diagnostic encrypted connection confirmed the credential and grants;
  certificate verification was not disabled in application code.
- Added `HOSTED_AUTH_DATABASE_CA_CERT` and require the downloaded Supabase project CA when creating
  the PostgreSQL pool. The connector retains `rejectUnauthorized: true` rather than accepting a
  self-signed chain without verification.
- `npm run test -w @powerotp/api` and `npm run typecheck -w @powerotp/api` passed.
- The production environment still needs `HOSTED_AUTH_DATABASE_CA_CERT` copied from the POTP
  Database Settings SSL Configuration panel before hosted-identity connectivity is enabled.

## 2026-08-22 00:49 UTC — P2-S2: MongoDB hot auth-request repository

Status and scope:

- P2-S2 is complete. This step added only the dedicated MongoDB hot auth-request repository,
  active/terminal expiry behavior, encrypted terminal results, poll-token hashing, and startup
  index creation.
- Durable retention/write-before-publish, project bindings, wrapped keys/KMS, identity sagas,
  provider adapters, and hosted-auth HTTP handlers were not started. Passport and BotBlocker plans
  and behavior remain unchanged.

Implemented data and behavior:

- Added the `powerotp_auth_runtime` MongoDB database boundary and its minimal
  `hostedAuthRequests` collection. It uses the existing MongoDB deployment/client but not the
  primary `powerotp` application database or the Supabase identity store.
- Active requests persist only a SHA-256 poll-token hash. Poll authorization binds request ID,
  project, flow, and a constant-time token-hash comparison; the raw shown-once token is never
  persisted.
- Client-selected active lifetime is validated through the P1-S4 contract at 300–86,400 seconds
  with a 1,800-second default. The active `purgeAt` is exactly `createdAt + selected TTL`.
- A single atomic guarded update publishes one immutable terminal state only while the request is
  active. Its JSON result is AES-256-GCM encrypted under a dedicated server-only key, and
  `resultExpiresAt`/`purgeAt` are exactly 180 seconds after `completedAt`.
- Poll reads enforce both expiry boundaries synchronously because MongoDB TTL cleanup is
  asynchronous. At the exact boundary the result is unavailable and the repository opportunistically
  deletes the matching record; the exact-date TTL index provides background cleanup.
- Server startup creates the hot-store TTL and project/request lookup indexes against the dedicated
  runtime database. No runtime route or repository consumer was added.
- Added optional `HOSTED_AUTH_RUNTIME_RESULT_ENCRYPTION_KEY` validation. It remains inactive until a
  later hosted-auth handler constructs the repository and must be installed as a distinct
  production server secret before that handler is enabled; `.env` was not read or modified.

Affected files:

- `backend/packages/api/src/hosted-auth-request-repository.ts`
- `backend/packages/api/src/hosted-auth-request-repository.test.ts`
- `backend/packages/api/src/config.ts`
- `backend/packages/api/src/config.test.ts`
- `backend/packages/api/src/dependencies.ts`
- `backend/apps/server/lib/server-context.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Database reads expose neither a reusable poll token nor a plaintext terminal result. Wrong-project
  and wrong-flow lookups do not locate a record, and token verification occurs before an authorized
  caller receives expiry state.
- The repository reuses the existing authenticated encryption primitive and keeps its result key
  independent from PII, provider configuration, sessions, API keys, and BotBlocker secrets.
- This is an additive MongoDB collection/index change on the existing deployment. It does not
  change the P2-S1 Supabase schema, public/client contracts, routes, provider credentials, or `.env`.

Focused verification:

- `npm run build -w @powerotp/contracts` — passed as the local prerequisite that refreshed the
  already-committed P1-S4 contract output.
- `npm run test -w @powerotp/api` — passed (411 tests), including repository, TTL-boundary,
  encryption-at-rest, terminal immutability, and token-hash tests.
- `npm run typecheck -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` followed by `npm run typecheck -w @powerotp/backend` — passed for
  the server startup/database wiring.
- No full-monorepo verification was run; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S2 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S3 — add the separate durable redacted auth-request retention database and enforce
  write-before-publish without beginning project bindings, wrapped keys, KMS integration, identity
  sagas, providers, or runtime HTTP handlers.

## 2026-08-22 01:02 UTC — P2-S2 correction: fixed active ceremony timeout

Status and correction:

- The owner rejected exposing active-request lifetime as a client-selected setting. The canonical
  active hosted sign-up/sign-in ceremony now has one server-controlled ten-minute lifetime.
- Removed the 300–86,400-second range, 1,800-second default, and
  `requestExpiresInSeconds` repository/API-plan input. Older entries above remain historical and are
  superseded by this correction.
- The independent terminal-result rule is unchanged: completion replaces the active expiry with
  `completedAt + 180 seconds`, after which the hot record, poll-token hash, and encrypted result are
  unavailable and deleted.

Implemented changes:

- The P1-S4 executable contract now exposes `HOSTED_AUTH_ACTIVE_TTL_SECONDS = 600` and validates
  `expiresAt = createdAt + 600 seconds` without accepting a caller-selected lifetime.
- The P2-S2 repository no longer accepts a lifetime argument and always writes the fixed active
  expiry. Tests cover availability immediately before the ten-minute boundary, unavailability at
  the exact boundary, terminal replacement of that expiry, and rejection of publication at active
  expiry.
- The canonical create-request plan payload now contains only `flow`; project settings and the P6-S1
  roadmap no longer advertise lifetime configuration.
- Runtime HTTP handlers still do not exist. Mapping a missing or expired request to its final stable
  HTTP response remains owned by P6 and was not introduced in this correction.

Security and compatibility impact:

- Clients cannot prolong abandoned or replayable ceremonies. Every incomplete request is bounded to
  ten minutes under server policy.
- Completed results remain independent of how much active time was unused and are retained for
  exactly three minutes from completion.
- No database migration, provider credential, `.env`, Supabase, Passport, or BotBlocker change is
  required.

Focused verification:

- `npm run test -w @powerotp/contracts` — passed (262 tests).
- `npm run typecheck -w @powerotp/contracts` — passed.
- `npm run build -w @powerotp/contracts` — passed and refreshed the API's local workspace output.
- `npm run test -w @powerotp/api` — passed (415 tests).
- `npm run typecheck -w @powerotp/api` — passed.

Commit, push, and remote check:

- The correction commit contains this entry. Its final hash, push confirmation, and remote Verify
  result are reported after push.

Next step:

- P2-S3 remains the next dependency step.

## 2026-08-22 01:17 UTC — P2-S3: durable redacted auth-request retention

Status and scope:

- P2-S3 is complete. It adds only the separate durable MongoDB auth-request retention repository
  and enforces durable write-before-terminal-result publication.
- Project bindings, wrapped keys, KMS integration, identity sagas, provider adapters, MCP behavior,
  runtime HTTP handlers, Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Added the `powerotp_auth_retention` database and `authRequestRetention` collection on POWEROTP's
  existing protected MongoDB deployment. It is separate from both the primary `powerotp` database
  and short-lived `powerotp_auth_runtime` database.
- Retention records use a strict allowlist containing only request/project/flow, authentication
  method, optional redacted binding/provider/balance references, canonical assurance and verification
  levels, terminal outcome and stable failure reason, correlation ID, request/completion times, and
  an explicit finite retention expiry.
- The repository rejects unknown fields, unsorted or duplicate levels, impossible timestamps,
  successful records with failure reasons, and non-success records without stable failure reasons.
  Poll tokens and hashes, browser handles, PII, provider secrets, complete client results, and
  sensitive payloads have no accepted storage field.
- Exact duplicate retention writes are idempotent through request-ID upsert. A changed replay for
  the same request fails as a conflict instead of rewriting canonical audit evidence.
- Terminal publication first confirms that the matching project request remains active, writes the
  durable redacted record, and only then performs the guarded hot-store update. A failed retention
  write leaves the hot request active and its terminal result unavailable.
- Startup creates exact-date retention-expiry, project/completion, and correlation lookup indexes.
  No default legal retention duration was invented; later callers must supply the approved finite
  expiry.

Affected files:

- `backend/packages/api/src/hosted-auth-retention-repository.ts`
- `backend/packages/api/src/hosted-auth-retention-repository.test.ts`
- `backend/packages/api/src/hosted-auth-request-repository.ts`
- `backend/packages/api/src/hosted-auth-request-repository.test.ts`
- `backend/packages/api/src/hosted-auth-request-repository.test-support.ts`
- `backend/packages/api/src/dependencies.ts`
- `backend/apps/server/lib/server-context.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Durable support/billing/audit data cannot contain the short-lived polling credential or complete
  client result. Database isolation keeps retained evidence independent from runtime TTL deletion.
- Publication fails closed when durable storage is unavailable. Retry uses the exact duplicate as an
  idempotent durable write, while conflicting evidence remains immutable.
- This is an additive database/index boundary on the existing MongoDB deployment. It adds no
  environment variable, does not modify `.env`, and changes no public HTTP contract.

Focused verification:

- `npm run test -w @powerotp/api` — passed, including redaction, ordering, durable-write failure,
  duplicate/conflict, index, expiry-validation, and database-isolation coverage.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` followed by `npm run lint -w @powerotp/backend` — passed for
  generated API declarations and server startup wiring.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S3 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S4 — add only project binding, wrapped-key metadata, hosted-auth template, and non-request
  security-event schemas without beginning per-person cryptography/KMS integration or identity sagas.

## 2026-08-22 01:28 UTC — P2-S4: durable hosted-auth supporting schemas

Status and scope:

- P2-S4 is complete. It adds only strict project-binding, wrapped-key metadata, hosted-auth
  Template 1, and non-request security-event storage schemas plus their uniqueness/lookup indexes.
- Per-person DEK generation/encryption, KMS calls, key rotation, project-user-ID derivation, identity
  sagas, provider adapters, MCP behavior, runtime HTTP handlers, Passport, and BotBlocker remain
  unchanged.

Implemented data and behavior:

- Added strict project-binding records containing the internal binding ID, private person ID,
  owning project, pairwise project user ID, lifecycle status, derivation version, and bounded
  timestamps. Exact duplicate creation is idempotent; a changed replay for the same binding ID
  fails instead of replacing the persisted project user ID.
- Added wrapped-key metadata records containing only the private person reference, KMS key version,
  wrapped-DEK ciphertext, lifecycle status, and crypto-shredding timestamp. Active records require
  ciphertext; crypto-shredded records require ciphertext removal. No plaintext DEK, key generation,
  unwrap operation, KMS client, or rotation behavior was added.
- Added one strict per-project/page/Template 1 record with exactly Rows A–F, bounded structured text,
  opaque Bunny asset references with required alt text, exactly six independent ad toggles,
  optimistic revision metadata, and no raw HTML/CSS/script or remote-image URL field.
- Added finite-retention, append-only non-request security events for credential, project auth
  configuration, wrapped-key, identity-deletion, abuse, and privileged-support changes. Events
  contain only canonical actor/target references, changed-field names, outcome/reason, correlation,
  and timestamps; auth-request IDs, tokens/hashes, browser handles, PII, provider payloads, and
  arbitrary detail objects have no accepted field.
- Added unique indexes for `(projectId, hostedPersonIdentityId)`,
  `(projectId, projectUserId)`, one wrapped-key record per person, and
  `(projectId, pageType, templateType)`. Security events have project/time lookup and exact-date
  finite-retention indexes.
- Startup creates bindings, wrapped-key, and security-event indexes in
  `powerotp_auth_retention`; template configuration uses the primary project-content database.
  Supabase identity and `powerotp_auth_runtime` remain separate and unchanged.

Affected files:

- `backend/packages/api/src/hosted-auth-durable-schemas.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.test.ts`
- `backend/apps/server/lib/server-context.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Strict nested schemas and opaque references reject undeclared sensitive or executable fields.
  Binding creation and event append paths expose no overwrite operation.
- All changes are additive MongoDB collections/indexes on existing database connections. No
  environment variable, `.env`, Supabase migration, provider credential, public route, client
  response, Passport behavior, or BotBlocker behavior changed.
- No legal retention duration was invented. Security-event callers must provide an approved finite
  expiry; binding/template lifecycle deletion and wrapped-key crypto-shredding remain owned by their
  later planned services.

Focused verification:

- `npm run test -w @powerotp/api` — passed (428 tests), including strict schema, redaction,
  uniqueness/index, page isolation, immutable binding, and append-only security-event coverage.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` followed by `npm run lint -w @powerotp/backend` — passed for
  generated declarations and startup index wiring.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S4 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S5 — add per-person DEK generation, AEAD associated-data envelope encryption, KMS integration,
  and wrapped-key persistence without beginning P2-S6 project-user-ID/lookup-secret derivation or
  key rotation.

## 2026-08-22 01:38 UTC — P2-S5: per-person envelope encryption and KMS

Status and scope:

- P2-S5 is complete. It adds only per-person DEK creation, field-bound AEAD envelope encryption, a
  concrete AWS KMS key-wrapping adapter, and wrapped-key persistence in the durable retention
  database.
- Project-user-ID derivation, keyed lookup secrets, key rotation, identity sagas, provider adapters,
  MCP behavior, runtime HTTP handlers, Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Added a strict encrypted-field envelope for `email`, `phone`, and `derived_date_of_birth` using
  AES-256-GCM with a fresh 96-bit nonce and 128-bit authentication tag. Associated data is a
  deterministic tuple of `hostedPersonIdentityId`, field name, positive schema version, and
  canonical purpose, so moving or relabeling ciphertext fails authentication.
- Added one random 256-bit DEK per hosted person. The service reuses the persisted active key for
  that person, zeroes transient plaintext-key buffers after use, and never returns or persists the
  DEK.
- Added `AwsKmsHostedAuthIdentityKeyAuthority` using AWS KMS Encrypt/Decrypt operations. KMS
  encryption context binds the private person ID and fixed hosted-identity-DEK purpose; denial,
  missing output, malformed key length, and key-version mismatch fail closed.
- Added an insert-only wrapped-key repository over `wrappedIdentityKeys`. Concurrent creation keeps
  the first persisted active wrapped key and loads that canonical key without replacing it.
  MongoDB stores only the person reference, logical KMS key version, KMS ciphertext, status, and
  creation time.
- Supabase encrypted attribute rows continue to hold only the field envelope components. The
  wrapped DEK remains in `powerotp_auth_retention`, and usable key authority remains in KMS.
  Therefore neither a Supabase dump nor a MongoDB dump alone can decrypt recoverable PII.
- Added the AWS KMS SDK package dependency. The adapter accepts an injected production client or
  client configuration; no environment variable or `.env` change was made.

Affected files:

- `backend/packages/api/src/hosted-auth-identity-encryption.ts`
- `backend/packages/api/src/hosted-auth-identity-encryption.test.ts`
- `backend/packages/api/src/hosted-auth-durable-schemas.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `backend/packages/api/package.json`
- `backend/package-lock.json`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Tests reject person, field, schema-version, purpose, nonce/ciphertext/tag substitution, KMS
  wrapping and unwrapping denial, plaintext-key persistence, and cross-database key/ciphertext
  co-location.
- Existing Supabase columns and the P2-S4 MongoDB collection/index are used without migration.
  This step adds no route, client response, provider credential, project identifier derivation,
  lookup hash, key rotation behavior, or environment requirement.

Focused verification:

- `npm run test -w @powerotp/api` — passed (433 tests).
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` followed by `npm run lint -w @powerotp/backend` — passed for
  generated API declarations and backend package compatibility.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S5 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S6 — add project-user-ID pepper derivation, dedicated keyed lookup secrets, and key rotation
  without beginning P2-S7 person/profile/contact creation sagas.

## 2026-08-22 01:48 UTC — P2-S6: KMS-backed pairwise and lookup derivation rotation

Status and scope:

- P2-S6 is complete. It adds only project-user-ID derivation, dedicated keyed lookup derivation,
  versioned rotation behavior, immutable binding reuse, and lookup-key-version persistence.
- Person/profile/contact creation sagas, provider adapters, MCP behavior, runtime HTTP handlers,
  `.env`, Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Added AWS KMS `GenerateMac` integration using HMAC-SHA-256. Project-user derivation and each
  global/mode/channel lookup purpose require independently configured KMS HMAC keys; duplicate key
  IDs across domains are rejected, and application code receives only 256-bit MAC outputs.
- Project user IDs derive from the private person ID, a zero delimiter, and the project ID under the
  current versioned project-subject KMS key. The result is validated as the canonical `pusr_`
  identifier and persisted with its derivation version.
- Added atomic project/person binding lookup and insert-if-absent behavior. A stored binding is
  returned before any new derivation, so project IDs remain immutable across key rotation and
  concurrent creation retains one canonical binding.
- Added dedicated `global_contact_link`, `powerotp_pii_email`, `powerotp_pii_phone`,
  `didit_pii_email`, and `didit_pii_phone` lookup domains. New values use the current key version;
  reads derive candidates for the current and explicitly retained prior versions.
- Applied the production Supabase migration adding required positive `lookup_key_version` to
  `hosted_auth.contacts`. The contact uniqueness key now includes mode, channel, key version, and
  lookup hash. Existing empty production storage was assigned version 1 during migration, and the
  default was removed so future writes must state their version.

Affected files:

- `backend/packages/api/src/hosted-auth-keyed-derivation.ts`
- `backend/packages/api/src/hosted-auth-keyed-derivation.test.ts`
- `backend/packages/api/src/hosted-auth-keyed-derivation-migration.test.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `supabase/migrations/20260822020000_p2_s6_lookup_key_rotation.sql`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Domain-specific KMS keys and purpose-bound lookup messages prevent project-subject, global-link,
  custody-mode, email, and phone derivations from being substituted. Same-person IDs differ across
  projects.
- Derivation peppers and lookup secrets remain exclusively in KMS; MongoDB stores only immutable
  public pairwise IDs and versions, while Supabase stores only lookup MACs and versions. KMS denial
  fails closed without creating a binding or lookup result.
- Rotation is additive: persisted project IDs are never recomputed, and retained lookup versions
  remain queryable while new lookup writes use the current version. Removing an old lookup key from
  the configured KMS key ring intentionally removes authority to query that version.
- No environment variable, route, provider credential, client response, identity saga, Passport
  behavior, or BotBlocker behavior changed.

Focused verification:

- `npm run test -w @powerotp/api` — passed (439 tests), including domain separation, cross-project
  unlinkability, KMS denial, binding persistence/restart, rotation, migration, and secret-exclusion
  coverage.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` — passed.
- Production Supabase migration `p2_s6_lookup_key_rotation` applied successfully.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S6 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S7 — add the person/profile/contact creation saga and compensation while preserving the
  P2-S1 through P2-S6 store, custody, cryptographic, immutable-binding, and rotation boundaries.

## 2026-08-22 02:07 UTC — P2-S7: person/profile/contact creation saga and compensation

Status and scope:

- P2-S7 is complete. It adds only pending person, realm-profile, encrypted/contact-row creation,
  idempotent duplicate reuse, transactional rollback, and wrapped-key compensation.
- Reconciliation workers, provider adapters, MCP behavior, runtime HTTP handlers, `.env`, Passport,
  and BotBlocker remain unchanged.

Implemented data and behavior:

- Added a custody-discriminated creation saga that canonicalizes email or E.164 phone input, derives
  the current and retained prior mode/channel lookup candidates through the P2-S6 KMS service, and
  reuses an existing same-mode contact before creating any new identity or encryption material.
- New private person/profile IDs and WebAuthn user handles use 256 random bits. The profile RP ID is
  selected only from the immutable custody mode: `authx.powerotp.com` for `powerotp_pii` and
  `authz.powerotp.com` for `didit_pii`.
- `powerotp_pii` uses the P2-S5 per-person envelope service and persists only ciphertext, nonce,
  authentication tag, key version, purpose, lookup MAC/version, and masked destination in Supabase.
  `didit_pii` persists no recoverable contact or encrypted attribute and requires an opaque
  provider contact reference for the later real adapter to supply.
- Person, profile, optional encrypted attribute, and contact rows are inserted in one PostgreSQL
  transaction. Any row failure rolls back the complete Supabase unit.
- The mode/channel/version/hash uniqueness constraint resolves concurrent duplicate creation to the
  canonical persisted identity. A losing `powerotp_pii` attempt deletes its newly created active
  wrapped DEK from the separate retention store. Compensation failure is surfaced as an aggregate
  failure rather than hidden.
- Equal contact values in different custody modes create separate person roots. This step does not
  derive or act on the global contact-link domain and never merges person roots from contact
  equality alone.

Affected files:

- `backend/packages/api/src/hosted-auth-identity-saga.ts`
- `backend/packages/api/src/hosted-auth-identity-saga.test.ts`
- `backend/packages/api/src/hosted-auth-identity-repository.ts`
- `backend/packages/api/src/hosted-auth-identity-repository.test.ts`
- `backend/packages/api/src/hosted-auth-identity-encryption.ts`
- `backend/packages/api/src/hosted-auth-identity-encryption.test.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Contact plaintext is transient and enters only the custody-compatible keyed derivation/encryption
  boundary. It is absent from saga results, lookup rows, and the Didit-custody persistence path.
- Lookup rotation remains additive: retained prior versions prevent duplicate roots after rotation,
  while new contacts persist only the current version. Project bindings and pairwise IDs are not
  created or changed by this saga.
- The existing P2-S1/P2-S6 schema and constraints are sufficient; no migration, environment value,
  provider credential, route, public/client response, or deployment configuration changed.

Focused verification:

- `npm run test -w @powerotp/api` — passed (448 tests), including success, idempotency, rotation
  duplicate prevention, custody separation, no equality-based cross-mode merge, SQL rollback,
  concurrent-loser cleanup, partial failure, and compensation-failure coverage.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` — passed.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S7 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Known limits and next step:

- Provider-owned Didit contact creation/validation remains assigned to Phase 4; P2-S7 accepts only
  its opaque persistence reference and does not call a provider.
- P2-S8 — add reconciliation workers and orphan detection for pending/partial identity artifacts
  without beginning P2-S9 retention/deletion/Didit cleanup orchestration.

## 2026-08-22 02:19 UTC — P2-S8: pending identity reconciliation and orphan detection

Status and scope:

- P2-S8 is complete. It adds only bounded stale-pending claims, identity-artifact inspection,
  retry dispatch, safe partial-store compensation, and standalone wrapped-key orphan detection.
- P2-S9 retention/deletion/Didit cleanup orchestration, provider adapters, MCP behavior, runtime HTTP
  handlers, `.env`, Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Added a reconciliation repository that atomically claims stale pending person roots with
  `FOR UPDATE SKIP LOCKED` and a refreshed `updated_at` lease. Immediate duplicate worker runs
  therefore do not dispatch the same retry twice; a failed item becomes eligible again only after
  the fixed 15-minute stale interval.
- Artifact inspection checks the complete person/profile/contact/encrypted-attribute shape, exact
  custody-mode RP ID, pending statuses, and credential/consent/verification dependents without
  reading contact plaintext, lookup hashes, ciphertext, or provider payloads.
- Complete `powerotp_pii` artifacts are retried only when their separate active wrapped DEK exists.
  Complete `didit_pii` artifacts are retried without a wrapped DEK; an unexpected wrapped key is
  compensated first. Retry dispatch carries only private person/profile IDs and immutable mode.
- Safely removable partial Supabase units are deleted in one guarded PostgreSQL transaction, then
  any active wrapped key is idempotently compensated. State changes, foreign-key dependents, or
  concurrent completion cause cleanup to fail/skip without partial row deletion.
- Stale active wrapped keys are paged deterministically and compared with authoritative Supabase
  person existence. Keys with no person and no immutable project binding are deleted; a binding
  blocks cleanup. Paging continues past legitimate live keys so later orphans cannot starve.
- Provider-referenced malformed Didit artifacts are surfaced as `provider_cleanup_required` and
  preserved for P2-S9 rather than losing the reference or beginning provider deletion here.
- Each claimed identity and orphan-key candidate is failure-isolated, so one retry/store failure
  does not prevent independent artifacts from reconciling.

Affected files:

- `backend/packages/api/src/hosted-auth-identity-reconciliation.ts`
- `backend/packages/api/src/hosted-auth-identity-reconciliation-repository.ts`
- `backend/packages/api/src/hosted-auth-identity-reconciliation.test.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Security, compatibility, and migration impact:

- Reconciliation never derives contact equality, searches another custody mode, attaches a profile,
  merges roots, creates/changes a project binding, decrypts PII, or moves credentials across realms.
- Active or bound identities and artifacts with later-phase dependents are not destructively
  reconciled. Didit provider deletion and legal retention remain entirely deferred to P2-S9.
- Existing P2-S1/P2-S6 columns, constraints, and indexes are sufficient. No Supabase or MongoDB
  migration, environment value, provider credential, public route, client response, deployment
  configuration, Passport behavior, or BotBlocker behavior changed.

Focused verification:

- `npm run test -w @powerotp/api` — passed (455 tests), including orphan detection, retry,
  duplicate-run lease behavior, both custody modes, missing-key/partial-store cleanup, scan
  pagination, protected binding/provider artifacts, and per-item failure isolation.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` — passed.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S8 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Known limits and next step:

- The worker accepts an injected idempotent retry continuation; later signup orchestration supplies
  that continuation when it activates the P2-S7 creation path. No provider or HTTP behavior is
  fabricated in this infrastructure step.
- P2-S9 — add retention/deletion/Didit cleanup orchestration while preserving P2-S8 claims,
  failure isolation, custody boundaries, immutable bindings, and cryptographic compensation.

## 2026-08-22 02:30 UTC — P2-S9: retention and provider-cleanup deletion orchestration

Status and scope:

- P2-S9 is complete. It adds policy-scheduled identity deletion, immediate blocked/revoked state,
  leased retries, runtime purge coordination, vendor-neutral Didit cleanup, evidence disposition,
  binding deletion, and final local minimization.
- P2-S10 crypto-shredding and backup/restore behavior, concrete provider adapters, MCP behavior,
  runtime HTTP handlers, `.env`, Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Added explicit `deletion_requested_at`, caller-supplied `deletion_eligible_at`, and leased
  `deletion_claimed_at` state to hosted person identities. Scheduling immediately changes the
  person/profiles to `deleting`, revokes credentials and contacts, and therefore blocks new
  authentication while the approved retention date remains in force.
- No calendar duration or default evidence policy was invented. The caller supplies the approved
  eligibility date, and an injected policy supplies whether consent and minimal verification
  evidence must be retained.
- Eligible identities are claimed with `FOR UPDATE SKIP LOCKED` and a 15-minute lease. Exact
  duplicate schedules and immediate duplicate worker runs are idempotent; changed eligibility is
  rejected rather than silently rewriting the approved schedule.
- The orchestrator purges identity-linked hot runtime data through an injected boundary, calls a
  vendor-neutral provider cleanup boundary only when opaque provider references exist, then marks
  project bindings deleted and atomically minimizes Supabase data.
- Provider mappings/contact references remain stored while provider cleanup fails or any later
  store step fails. Successful or already-absent provider deletion is retry-safe; local finalization
  clears provider mappings, contact lookups/ciphertext, credentials, derived DOB ciphertext, and
  provider operation references before recording the person/profile tombstone.
- Required consent/minimal verification evidence can remain under the injected legal policy, while
  unnecessary evidence is deleted. Neither deletion results nor failure results expose provider
  references, PII, private/global IDs beyond the internal worker key, evidence, or key material.
- P2-S8 provider-referenced malformed pending artifacts can now be handed to the durable deletion
  schedule. The guarded repository accepts that zero-delay path only for a pending identity with a
  retained provider contact reference; cleanup remains provider-first and does not discard the
  reference.
- Runtime, provider, policy, binding, and final-store failures are isolated per identity. A partial
  run leaves the identity blocked and lease-retryable; no step reactivates an identity or changes
  an immutable project-scoped user ID.

Affected files and migration:

- `backend/packages/api/src/hosted-auth-identity-deletion.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion-contracts.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion-repository.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion.test.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion-migration.test.ts`
- `backend/packages/api/src/hosted-auth-identity-reconciliation.ts`
- `backend/packages/api/src/hosted-auth-identity-reconciliation.test.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `supabase/migrations/20260822023000_p2_s9_identity_deletion.sql`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`
- Production Supabase migration `p2_s9_identity_deletion` was applied successfully to project
  `ozfufuxpdrsfbamopszb`; the hosted-auth tables were empty before application.

Security, compatibility, and known limits:

- Didit-specific payloads and SDK types do not enter orchestration. The later Phase 4 adapter must
  implement the injected idempotent provider boundary.
- Deletion does not derive contact equality, merge roots, unwrap/delete wrapped keys, invoke KMS,
  or begin P2-S10 crypto-shredding/backup behavior.
- The migration is additive and preserves forced RLS and existing service roles. No environment
  value, provider credential, public/client contract, route, deployment configuration, Passport
  behavior, or BotBlocker behavior changed.

Focused verification:

- `npm run test -w @powerotp/api` — passed (464 tests), including blocked retention, provider
  failure/reference preservation, duplicate lease runs, partial-store retry, evidence policy,
  provider-free deletion, reconciliation handoff, and per-identity failure isolation.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` — passed.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S9 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P2-S10 — implement crypto-shredding and backup/restore behavior while preserving P2-S9 blocked
  deletion, provider confirmation, legal-evidence retention, immutable binding, and retry
  boundaries.

## 2026-08-22 03:00 UTC — P2-S10: crypto-shredding and backup/restore behavior

Status and scope:

- P2-S10 is complete. It adds only irreversible wrapped-DEK shredding, authoritative lifecycle
  guards, backup-restore replay, and integration into the P2-S9 deletion worker.
- Provider adapters, KMS-key deletion, MCP behavior, runtime HTTP handlers, `.env`, Phase 3,
  Passport, and BotBlocker remain unchanged.

Implemented data and behavior:

- Eligible deletion now durably records `provider_cleanup_satisfied_at` only after the deletion
  worker has completed the required provider cleanup (or determined from the claimed candidate
  that none exists). PostgreSQL rejects this marker before the caller-supplied
  `deletion_eligible_at`.
- The worker then atomically changes the MongoDB wrapped-key record from `active` to
  `crypto_shredded`, removes `wrappedDekCiphertext` in the same update, records
  `cryptoShreddedAt`, and durably mirrors completion as `crypto_shredded_at` on the authoritative
  person row before final local minimization. Missing keys are treated as already non-decryptable;
  store errors fail the identity closed and leave its leased deletion retryable.
- Duplicate runs accept only the ciphertext-free tombstone. A failure after MongoDB removal but
  before the PostgreSQL completion marker retries without recreating a key.
- Encryption and decryption now require the authoritative person lifecycle to be `pending` or
  `active` before key creation or unwrap. A deleting, deleted, missing, or crypto-shredded identity
  cannot recreate or unwrap a DEK, including when an older MongoDB backup reintroduces active
  wrapped ciphertext.
- Restore processing pages through authoritative PostgreSQL crypto-shred markers and re-applies the
  atomic MongoDB tombstone transition. A restored wrapped-key store must complete this replay before
  serving identity cryptography; PostgreSQL deletion/shred history must be restored or replayed to
  the recovery point before the older wrapped-key backup is admitted.
- P2-S9 still performs runtime purge and provider cleanup first, evaluates the injected legal
  evidence policy, crypto-shreds, marks immutable project bindings deleted, and finally removes PII
  ciphertext/provider references. Retained consent/minimal verification evidence is redacted and
  cannot decrypt retained PII after shredding.

Affected files and migration:

- `backend/packages/api/src/hosted-auth-identity-crypto-shredding.ts`
- `backend/packages/api/src/hosted-auth-identity-crypto-shredding.test.ts`
- `backend/packages/api/src/hosted-auth-identity-crypto-shredding-migration.test.ts`
- `backend/packages/api/src/hosted-auth-identity-encryption.ts`
- `backend/packages/api/src/hosted-auth-identity-encryption.test.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion.ts`
- `backend/packages/api/src/hosted-auth-identity-deletion.test.ts`
- `backend/packages/api/src/hosted-auth-durable-repository.ts`
- `supabase/migrations/20260822030000_p2_s10_crypto_shredding.sql`
- Production Supabase migration `p2_s10_crypto_shredding` was applied successfully to project
  `ozfufuxpdrsfbamopszb`; the hosted-auth tables were empty before application.

Security, compatibility, and known limits:

- Wrapped-key deletion is an atomic ciphertext-removing tombstone, not a KMS key deletion. Shared
  KMS key lifecycle remains outside this step; no KMS key material or provider evidence is exposed.
- The authoritative PostgreSQL marker prevents an older wrapped-key backup from authorizing
  decryption and supplies deterministic replay input. Restoring every store to a point before the
  deletion record would also restore pre-deletion state, so recovery procedures must retain/replay
  the deletion ledger through the selected recovery point rather than discarding it.
- No counsel-owned duration was added. No public/client contract, route, provider credential,
  environment value, project ID, binding derivation, custody rule, Passport behavior, or BotBlocker
  behavior changed.

Focused verification:

- `npm run test -w @powerotp/api` — passed (471 tests), including atomic shredding, duplicate runs,
  KMS-unwrap/recreation denial, restore replay, partial-store retry, migration ordering, and
  per-identity failure isolation.
- `npm run lint -w @powerotp/api` — passed.
- `npm run build -w @powerotp/api` — passed.
- No full-monorepo verification was run locally; remote Verify remains the complete pushed check.

Commit, push, and remote check:

- The coherent P2-S10 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify result check are reported in the post-push session handoff.

Next step:

- P3-S0 — provision `authx`/`authz` DNS, TLS, host routing/deployment configuration, health checks,
  environment separation, and CI deploy paths without beginning P3-S1 project schema behavior.

## 2026-08-22 03:32 UTC — P3-S0: hosted-auth realm deployment foundation

Status and scope:

- P3-S0 is complete. It provisions the two production realm domains on the existing backend App
  Platform component and adds exact host routing, realm health checks, environment separation, and
  post-deployment CI health gates.
- P3-S1 project identifiers, immutable project mode persistence, generated hosted URLs, return
  settings, provider adapters, hosted credential handlers, `.env`, Passport, MCP, and BotBlocker
  behavior were not started or modified.

Implemented deployment and behavior:

- `authx.powerotp.com` and `authz.powerotp.com` are CNAMEs to the existing
  `powerotpbackend-giavr.ondigitalocean.app` backend. Both are attached as backend App Platform
  custom domains; DigitalOcean terminates and renews TLS. Neither domain points to an Asterisk
  droplet or the frontend application.
- Added one immutable environment/realm map. Production binds `powerotp_pii` only to
  `authx.powerotp.com` and `didit_pii` only to `authz.powerotp.com`; each origin, hostname, and RP ID
  is unique. Staging, development, and test have distinct host maps and cannot resolve production
  realms.
- Added host-first middleware isolation. Until later hosted routes exist, a hosted realm permits
  only `/health/hosted-auth`; API, MCP, Passport, BotBlocker, and unknown paths receive a no-store
  `404`. Existing `api.powerotp.com` routing remains unchanged.
- Added a no-store realm health response that reports the exact deployment environment, custody
  mode, realm hostname, and RP ID. The API host and cross-environment hosts cannot use it.
- Main-branch Verify now gates each production realm independently after the backend deploy. It
  retries through App Platform deployment propagation and validates DNS/TLS, service status, exact
  production realm/RP ID, and exact custody mode.

Affected files:

- `.github/workflows/verify.yml`
- `backend/apps/server/app/health/hosted-auth/route.ts`
- `backend/apps/server/app/health/hosted-auth/route.test.ts`
- `backend/apps/server/lib/hosted-auth-realms.ts`
- `backend/apps/server/lib/hosted-auth-realms.test.ts`
- `backend/apps/server/lib/proxy.test.ts`
- `backend/apps/server/package.json`
- `backend/apps/server/proxy.ts`
- `docs/API_ROUTE_INVENTORY.md`
- `infrastructure/app-platform/README.md`
- `docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Operational finding and correction:

- The first backend restart exposed a pre-existing Atlas authorization gap from Phase 2:
  the production `MONGODB_URI` user could access `powerotp` but could not create startup indexes in
  `powerotp_auth_runtime`. The same narrowly scoped user now has `readWrite` on
  `powerotp_auth_runtime` and `powerotp_auth_retention`, retaining its existing `powerotp` access
  and cluster restriction. No cluster-wide role or credential change was introduced.
- After the grant and backend restart, `api.powerotp.com/health`, the `authx` TLS route, and the
  `authz` TLS route returned `200`. Public Google and Cloudflare resolvers returned both realm
  CNAMEs to the backend; one local resolver temporarily retained the earlier negative DNS response
  during normal propagation.

Security, compatibility, and known limits:

- Realm selection is derived from the exact deployment environment and request hostname, never
  from a project, query, body, cookie, or caller-supplied custody claim. Cross-mode and
  cross-environment hostname substitution fails closed.
- The realm health route is public but contains no project, identity, credential, provider, store,
  or secret data. It is explicitly non-cacheable.
- Both realms reuse one backend artifact and App Platform deployment pipeline but remain separate
  HTTP origins and future WebAuthn RP IDs. This step creates no cookie, credential, project, or
  identity state.

Focused verification:

- `npm run test -w @powerotp/backend` — passed (25 tests), including realm mapping, environment
  isolation, host routing, health responses, API-host preservation, and route inventory.
- `npm run lint -w @powerotp/backend` — passed.
- `npm run build -w @powerotp/backend` — passed and included `/health/hosted-auth` plus middleware.
- Production DNS/TLS/backend probes passed after Atlas authorization correction and restart.

Commit, push, and remote check:

- The coherent P3-S0 commit contains this entry. Its final hash, push confirmation, and one remote
  Verify/deployment result check are reported in the post-push handoff.

Next step:

- P3-S1 — add required immutable `identityDataMode`, opaque `identifierString`, exact auth realm/RP
  ID, and generated hosted URLs on project creation without beginning P3-S2 return settings or
  assurance configuration.

## 2026-08-22 03:44 UTC — P3-S0 correction: authenticated public-realm handoff

Finding and correction:

- The first pushed realm checks reached the newly deployed route but received
  `hosted_auth_realm_unavailable`. DigitalOcean's reverse proxy preserves the public custom-domain
  hostname at Next.js middleware, while the downstream route handler's reconstructed URL uses an
  internal hostname.
- The host-first middleware remains the sole realm authority. It now removes any caller-supplied
  internal realm header, resolves the exact public hostname/environment, and forwards the validated
  realm hostname to the health handler through a middleware-owned request header. The handler no
  longer re-authorizes from its internal URL.
- API-host requests have the internal header stripped, cross-environment realm hosts still fail
  closed, and hosted realms still expose only the health route. Tests cover the trusted handoff,
  caller-header stripping, missing handoff, both custody modes, and API-host preservation.

Focused verification:

- `npm run test -w @powerotp/backend` — passed (26 tests).
- `npm run lint -w @powerotp/backend` — passed.
- `npm run build -w @powerotp/backend` — passed.

Commit, push, and remote check:

- This correction is included in a P3-S0 follow-up commit. Final push and replacement Verify/
  deployment status are reported in the post-push handoff.

Next step:

- P3-S1 remains unchanged.

## 2026-08-22 03:51 UTC — P3-S0 correction: single realm authority across runtimes

Finding and correction:

- The first proxy-handoff deployment proved the internal realm header reached the route, but the
  route still returned unavailable because it independently selected a deployment environment in
  the Node route runtime. Next.js middleware and route bundles do not provide a safe basis for
  duplicating that runtime environment decision.
- Removed the duplicate route-level environment selection. Middleware still validates the exact
  hostname against the active deployment environment and strips caller-supplied internal headers.
  The health handler now resolves only the middleware-validated hostname against the globally unique
  immutable realm map. Because every environment/mode hostname is unique, this preserves exact
  environment and custody identity without a second runtime-dependent authorization decision.

Focused verification:

- `npm run test -w @powerotp/backend` — passed (26 tests), including a route-runtime environment
  mismatch case that still reports the exact middleware-authorized production realm.
- `npm run lint -w @powerotp/backend` — passed.
- `npm run build -w @powerotp/backend` — passed.

Commit, push, and remote check:

- This correction is included in a second P3-S0 follow-up commit. Final push and replacement
  Verify/deployment status are reported in the post-push handoff.

Next step:

- P3-S1 remains unchanged.
