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
- P1-S4 through P15-S6 — not started

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
