# POWEROTP Sign-In as a Service — hosted credential pages plan

Proposed direction for POWEROTP's primary hosted credential service: passwordless/WebAuthn
sign-up, repeat sign-in, and optional hosted age/identity verification, with advertising used to
subsidize the hosted pages. This document describes intended direction only; it is not a record
of what is deployed.

P0-S1's normative glossary and executable-boundary mapping are recorded in
[`POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md`](POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md).
P0-S2's normative classification, custody, trust, abuse, retention, and deletion mapping is
recorded in
[`POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md`](POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md).
P0-S3's normative consent purposes, provider activation gates, certification wording, and
prohibited claims are recorded in
[`POWEROTP_SIGNIN_AD_SERVICE_CONSENT_AND_VENDOR_GATES.md`](POWEROTP_SIGNIN_AD_SERVICE_CONSENT_AND_VENDOR_GATES.md).

## Product boundary — do not conflate these services

The **Project card** is the client website administrator's control panel. One project represents
one client website and controls which of these independent POWEROTP services that website uses:

1. **Sign-in as a Service** — hosted passwordless/WebAuthn authentication for returning users.
2. **Sign-up as a Service** — hosted account enrollment and WebAuthn credential registration.
3. **BotBlocker** — an add-on human-verification service whose OTP challenge may load in an iframe
   on the client website.
4. **Age/identity verification** — hosted Didit-backed verification enabled when the client
   requires it.

This plan covers services 1 and 2, their optional use of service 4, and the advertising/content
layout of those hosted pages. It does **not** replace, redesign, or constrain service 3. The
BotBlocker iframe remains on the client website and is unrelated to the hosted credential-page
redirect described here.

The client website does not operate POWEROTP's identity system and does not store the user's PII,
WebAuthn credential, or age/identity evidence. POWEROTP authenticates the user and exposes only a
short-lived server-polled result containing a stable, project-scoped user ID. The
client stores that project-scoped ID with its local account so the same person can sign in later
through POWEROTP without exposing a global cross-site identifier.

---

## 1. Hosted credential-service model

The client website redirects the browser to a dedicated POWEROTP page for sign-up, sign-in, or
configured age/identity verification. This gives POWEROTP a first-party, top-level security
context in which to register or use WebAuthn credentials and maintain the authentication
request. It also gives each client a branded, crawlable page whose content and fixed ad
locations POWEROTP controls.

This hosted-page decision applies only to the credential and identity services in this document.
It says nothing about whether an iframe is appropriate for the separate BotBlocker OTP challenge.

## 2. Hosted URLs and credential flows

Project creation mints an opaque, non-guessable `identifierString`. Its immutable custody mode
selects one isolated authentication realm:

- `powerotp_pii` → RP/origin `https://authx.powerotp.com`
- `didit_pii` → RP/origin `https://authz.powerotp.com`

Each customer project receives separate hosted entry paths on its realm:

- `https://{realm}/signup/{projectName}/{identifierString}`
- `https://{realm}/signin/{projectName}/{identifierString}`

The readable project name is branding and routing context only. Authorization depends on the
opaque identifier and server-side project state, never on a guessable project-name slug.

### Sign-up

1. The client backend creates a signup authentication request with its project API key and receives
   `authRequestId`, `hostedUrl`, `pollToken`, `statusUrl`, and the active-request expiry.
2. The backend keeps `pollToken` server-side and redirects the browser only to `hostedUrl`.
3. POWEROTP authenticates an existing realm passkey or creates a restricted pending profile and
   realm passkey first, then verifies contact through the configured custodian and applies the
   project's required age/identity policy.
4. POWEROTP redirects the browser to the exact project signup return URL with only
   `authRequestId` and a non-authoritative completion hint.
5. The client backend polls `statusUrl` with both its API key and shown-once `pollToken`.
6. A successful result returns the stable **project-scoped user ID** and authorized verification
   outcomes. The client links it to its local account and creates its own website session.

### Returning sign-in

1. The client backend creates a new signin authentication request and stores the returned
   `pollToken` server-side.
2. The browser is redirected to the realm-specific hosted page, which attempts WebAuthn first and
   offers only the configured custody-mode fallback methods.
3. Every signin is a fresh ceremony for the requesting project. A prior client login or UI cookie
   never authenticates this request.
4. POWEROTP redirects the browser to the exact signin, failure, or recovery URL appropriate to the
   terminal browser outcome.
5. The client backend polls the authoritative result. Success returns the same project-scoped user
   ID so the client can open the correct local account and issue its own session/refresh tokens.

The active request has one server-controlled ten-minute lifetime. After any terminal outcome, the
poll result is available idempotently for exactly three minutes. The poll-token hash and sensitive
result payload are then deleted; a separate redacted retention record remains for audit and billing.

## 3. Project card service controls

The existing website Project card remains the single administrator surface for all four services.
It must show and control:

- Required immutable identity-data mode selected during project creation: `didit_pii` or
  `powerotp_pii`. The card shows the mode and explains that changing custody mode requires creating
  a new project; editing it in place is forbidden.
- Independent enablement/status for sign-in, sign-up, BotBlocker, and Didit age/identity
  verification.
- A sign-up template dropdown/edit button and a separate sign-in template dropdown/edit button.
  Each page and each template retains its own saved content when another template is selected.
- Six independent sign-up ad-position toggles and six independent sign-in ad-position toggles,
  allowing 0–6 enabled positions on each page. Disabled or unfilled positions reserve no space.
- Exact project-controlled `signupReturnUrl`, `signinReturnUrl`, `failureReturnUrl`,
  `recoveryReturnUrl`, and `restartUrl`. No open redirects, wildcard hosts, fragments,
  browser-Referer redirects, or per-request arbitrary return URL.
- The generated hosted sign-up and sign-in URLs, shown when the project is created.
- Client content fields and uploaded media used by the selected layouts.

Changing credential-page settings must not alter the BotBlocker iframe settings. Enabling Didit
adds its verification step to the configured credential flow; it does not turn BotBlocker into an
identity service.

## 4. Template 1 desktop and mobile layouts

Template 1 has independent desktop and mobile renderers that read the same saved content/schema and
use the same authentication state machine. Visual layout code is not shared between the renderers;
security, API, validation, and credential behavior are shared so they cannot drift.

### Desktop renderer

- **Left column, 65% width:** six rows, A–F. Rows A/C/E are image-left/text-right; Rows B/D/F
  are text-left/image-right. Each row has its own enabled state, image, accessible alt text, and
  safely structured rich text. Six fixed ad positions are interleaved after Rows A–F. Each
  position is independently enabled; if disabled or not filled by the ad provider it has zero
  height, so adjacent content closes together normally.
- **Right column, 35% width:** a centered, plain-white card hosting the selected POWEROTP
  sign-in or sign-up flow. Where configured, the flow can continue into the Didit age/identity
  step. Nav arrows on both sides of the card advance to the next card
  (security-education content, e.g. "how the QR handshake works") with a slide animation. A row
  of pagination dots below the card mirrors the cards one-to-one; the primary/default sign-in
  card's dot renders larger and blue to distinguish it from the secondary educational cards.
- All text in both columns must exist in the rendered DOM, not only in canvas/image form, so it
  remains crawlable and accessible.

### Mobile renderer

- Rows A–F form the vertically scrolling page background. Each enabled row renders its full-width
  image, then a fuzzy-bordered two-line rich-text box with an expand arrow, then its ad position.
- Expanding the text box reveals the complete saved rich text. Disabled rows and disabled/unfilled
  ads consume no height.
- A floating rounded credential-card container occupies approximately the bottom 25% of the dynamic
  viewport. The content background scrolls behind it and has sufficient bottom padding so the final
  row remains reachable.
- Credential-card arrows sit on its left/right edges. Navigation dots sit at the top; the primary
  card has the larger blue dot.
- Layout honors mobile safe-area insets, browser chrome, orientation changes, and onscreen keyboards.
- Desktop and mobile renderer code remain separate for every future template type.

POWEROTP owns every credential/education card. Clients can edit only their structured content rows,
images, template selection, and ad toggles.

## 5. Client design control and crawlable content

Per-block headline, description text, and image come from client-supplied structured fields
(via project dashboard/API) rendered into a POWEROTP-owned template — never raw client-submitted
HTML/CSS/JS:

- Text is edited with a safe rich-text editor supporting approved font families, bounded sizes,
  paragraphs, bold, italic, underline, and lists. The stored value is a validated structured
  document, not customer HTML or CSS.
- Images are uploaded and re-encoded/re-hosted on POWEROTP's own CDN — a client-supplied image
  URL is never hot-linked or rendered directly.
- No client-controlled layout, positioning, or script of any kind is accepted. This removes the
  injection surface entirely rather than requiring a sanitizer or a sandboxed cross-origin iframe
  to contain it, and it keeps the content same-origin and crawlable, which a sandboxed iframe
  would not be.
- Pair each project's dynamic content with permanent, POWEROTP-authored evergreen blocks (how
  passwordless/WebAuthn sign-in works, how POWEROTP protects user data, and relevant FAQs) reused
  across every project's
  page, so every hosted page carries a baseline of substantive original content independent of
  how much any individual project fills in.

## 6. Ad monetization model

- **Manually entered, direct-sold only for MVP** — no Google/third-party ad-network tag. POWEROTP
  staff enters approved fixed-size creative, destination, genre, weight, and active dates. Public
  self-serve advertiser intake, pricing metrics, and Stripe payment wait for the §7 pricing decision.
- **Mandatory manual review before any creative goes live.** This is non-negotiable given the
  placement sits on an authentication surface: check destination URLs and creative against a
  prohibited-content list (illegal, deceptive, malware/phishing, adult, etc.) before approval.
- Approved creative is served directly by POWEROTP's own backend (a DB row with genre tag,
  weight/rotation order, approval status) selected by the project's assigned genre — no external
  ad tag, so no `ads.txt`/cross-domain-authorization requirement applies to this model.
- Ad slots are fixed, hardcoded positions in the template (§4), never inside the client-editable
  content zone (§5), so neither a client nor an advertiser can reposition content to obscure the
  sign-in card or the "Protected by PowerOTP" trust messaging.
- A short advertiser terms page (prohibited categories, review turnaround, refund policy) is
  required before this goes live to anyone outside direct 1:1 deals.

## 7. Open questions

- Pricing model for ad slots (flat sponsorship vs. CPM vs. CPC) — affects the tracking/billing
  design and should be decided before the review-queue and Stripe integration are built.
- Whether/when to add a real third-party ad server (e.g. Kevel, Broadstreet) once direct-sold
  volume outgrows manual rotation — deferred until there's enough advertiser volume to justify it.
- Additional client-selectable layout styles can include the planned video-background/floating
  credential-card design after the initial 65/35 layout establishes the shared content, security,
  accessibility, and fixed-ad-slot contracts.

## 8. Identity and privacy invariants

- Client websites receive a project-scoped user ID, never POWEROTP's internal/global identity ID.
  The same POWEROTP user therefore has a different identifier at each client website.
- POWEROTP does not claim that hashing alone anonymizes PII. Lookup values that do not need to be
  recovered use keyed hashes; any data that must be recovered to provide the service is minimized
  and encrypted with controlled access and retention.
- WebAuthn private keys remain in the user's authenticator. POWEROTP stores the public credential
  material and server-side account binding needed to verify future assertions; the client website
  receives neither.
- Didit documents, selfies, and provider evidence are not returned to the client. The client gets
  only the minimum project-authorized verification outcome needed for its service.
- Every poll-result request is authenticated with both the project's server credential and the
  shown-once request poll token, and is audited.

---

## 9. Locked architecture and product decisions

These decisions are canonical for this service:

1. Hosted sign-up/sign-in is a POWEROTP identity-authentication service, not BotBlocker.
2. Browser ceremonies use top-level redirects to mode-isolated origins: `authx.powerotp.com` for
   `powerotp_pii` and `authz.powerotp.com` for `didit_pii`.
3. POWEROTP owns one private person identity with up to two cryptographically separate
   authentication profiles, one per custody mode. Each profile has its own RP ID, user handle,
   cookies, and passkeys.
4. Hosted-auth identity remains separate from Human Passport in this scope. A nullable future
   `passportIdentityId` link may be added without merging the products now.
5. A passkey is not created per client project. A realm-profile passkey can authenticate that
   profile at multiple projects in the same mode, but every client request still performs a fresh
   WebAuthn assertion. The person root produces a separate unlinkable binding for each client.
6. Clients receive and store only their stable project-scoped user ID and their own local account
   mapping. They never receive PII, encrypted PII, decryption keys, credential material, Didit
   evidence, or POWEROTP's internal identity ID.
7. Every customer project chooses one immutable `identityDataMode` at creation:
   - `didit_pii`: Didit is the email/contact custodian; POWEROTP stores keyed lookup values and the
     permanent Didit mapping but no recoverable email/phone plaintext.
   - `powerotp_pii`: POWEROTP is the email/contact custodian and stores recoverable PII encrypted in
     Supabase; POWEROTP's existing Brevo email service performs email login and recovery.
   Changing modes requires a new project because the storage, provider, consent, and recovery paths
   are different.
8. Recovery is an internal branch of a signin request. Clients can initiate signin but cannot
   authorize credential replacement.
9. Existing phone-passkey authentication uses native WebAuthn hybrid QR. Mobile transfer for Didit
   or recovery uses a distinct single-use POWEROTP handoff QR bound to the current auth request.
10. Password fallback, client PII release, cross-site cookies, customer/advertising authentication-
    page scripts, and per-project WebAuthn credentials are excluded from v1. The reviewed Didit Web
    SDK is the sole provider UI integration allowed during an explicit Didit session.
11. Template 1 is the only MVP page template. Sign-up and sign-in are separate page entities with
    independent settings even though Template 1 has the same visual arrangement for each.
12. The existing POWEROTP MCP remains public, generic, anonymous, project-unaware, and read-only.
    Project management is performed only through the normal project API or authenticated dashboard.
13. POWEROTP never creates a cross-project login session. Each project request receives fresh
    authentication; clients exclusively own their local sessions, refresh tokens, expiration, and
    logout.
14. New-user onboarding establishes the realm passkey before contact or optional qualification.
    The passkey identifies the POWEROTP profile; project bindings and current claims authorize it.
    Missing, declined, abandoned, or expired qualification leaves a restricted profile and never
    revokes an otherwise-valid passkey.
15. `identityDataMode` selects contact custody only. A `powerotp_pii` person may use any separately
    enabled Didit identity capability without moving contact custody to Didit.
16. End-user Didit capture uses backend-created Sessions API operations plus the reviewed Didit Web
    SDK. POWEROTP never uploads browser-captured provider media through standalone APIs for these
    flows.

### Permanent Didit identity mapping

For every hosted identity that uses a Didit feature, POWEROTP creates and stores two explicit values:

- `potpDiditId`: a POWEROTP-generated opaque random identifier sent to Didit as `vendor_data`.
- `diditInternalId`: Didit's stable `didit_internal_id` UUID returned by
  `POST /v3/users/create/`.

The permanent person-level mapping is
`hostedPersonIdentityId → potpDiditId → diditInternalId`. Every later Didit session sends the same
`potpDiditId`, causing Didit to attach it to the same persistent User entity. The person's
`powerotp_pii` and `didit_pii` authentication profiles share this person-level verification mapping
but never share passkeys or cookies. Clients receive none of these identifiers. A Didit
hosted-session token is temporary routing material for one provider screen and is never used as the
permanent identity mapping.

All Didit-returned contact/identity PII, document data, selfies, liveness media, biometric
templates, and full provider evidence remain in Didit's controlled systems under the configured
capability retention. POWEROTP stores only the opaque mapping, provider session/evidence references,
normalized non-PII claims, policy/version, timestamps, expiry, and audit/billing linkage. A client
receives neither the mapping nor provider data.

## 10. Trust boundaries, storage, and database models

### Storage responsibilities

**Supabase — authoritative hosted identity store**

- `hostedPersonIdentities`: private person ID, lifecycle status, nullable `potpDiditId` and
  `diditInternalId` until first Didit use, person-level verification claims, creation/deletion
  timestamps, optional future Passport link, and schema version.
- `hostedAuthProfiles`: unique `(personIdentityId, identityDataMode)` profile with profile ID,
  realm/RP ID, opaque WebAuthn user handle, contact-profile status, and lifecycle timestamps.
- `webauthnCredentials`: credential ID, public key, auth-profile ID, transports, sign counter,
  backup eligibility/state, authenticator metadata, name, created/last-used/revoked timestamps.
- `encryptedIdentityAttributes`: `powerotp_pii` email/phone or derived identity attributes with
  nonce/tag, key version, purpose, verification status, and retention timestamp. `didit_pii`
  identities never place recoverable email/phone values here.
- `recoveryMethods`: keyed email lookup for both modes; encrypted/masked destination and Brevo
  delivery metadata only for `powerotp_pii`; Didit verification references only for `didit_pii`.
- `consentRecords`: policy/text version, purpose, locale, exact decision, timestamp, and evidence.
- `identityVerifications`: vendor-neutral threshold/assurance claims, provider session/evidence
  references, source/method, policy version, verified/expiry/recheck dates, and deletion status. It
  contains no recoverable Didit-returned DOB, document field, media, or full decision.

**Runtime authentication store — minimal hot/portable data**

- Initial implementation uses a dedicated MongoDB `powerotp_auth_runtime` database behind the
  runtime repository. Its schema intentionally supports later migration to edge-compatible storage.
- `hostedAuthRequests`: request ID, project, mode, flow, lifecycle state, selected method,
  browser-handle hash, poll-token hash, provider operation ID, internal binding/profile reference,
  created/active-expiry/completed/result-expiry timestamps, and encrypted result.
- Active requests expire ten minutes after creation. Every terminal poll result expires three
  minutes after `completedAt`. Poll-token hashes and result payloads are deleted with the hot record.
- Keep the schema minimal behind a repository interface so this store can move to an edge-compatible
  database without migrating the durable audit model.

**Durable retention database — audit/billing/support**

- Initial implementation uses the primary protected MongoDB deployment in a separate
  `authRequestRetention` collection/database boundary from the hot runtime records.
- `authRequestRetention`: request ID, project, flow, method, redacted internal binding reference,
  provider operation reference, balance transaction ID, assurance/verification levels, outcome,
  stable failure reason, correlation ID, created/completed timestamps, and retention expiry.
- This record contains no poll token, browser handle, PII, provider session secret, or complete
  client result. It is durably written before any terminal poll result becomes visible.
- `projectIdentityBindings`: unique `(projectId, personIdentityId)` binding with immutable
  project-scoped user ID, status, created/last-authenticated timestamps, and derivation version.
- `wrappedIdentityKeys`: opaque identity reference, KMS key version, wrapped DEK, status, and
  crypto-shredding timestamp. No plaintext DEK is stored.
- `authPageTemplates`: one record keyed uniquely by `(projectId, pageType, templateType)`, with
  Rows A–F, rich-text documents, Bunny asset references, ad toggles, and update metadata.
- `authSecurityEvents`: append-only credential, configuration, key, deletion, abuse, and privileged
  support events not already represented by an auth-request retention row.

**KMS/HSM — key authority**

- Key-encryption keys that unwrap per-identity DEKs.
- Versioned project-subject derivation pepper.
- Dedicated keyed-lookup secrets.
- Rotation policy, least-privilege service grants, and immutable access logs.

### Encryption requirements

- Every recoverable PII field uses authenticated envelope encryption.
- AEAD associated data binds `hostedPersonIdentityId | fieldName | schemaVersion | purpose`.
- A Supabase dump cannot decrypt PII without the wrapped DEK and KMS authorization.
- A MongoDB dump cannot decrypt PII because wrapped DEKs are not usable keys.
- Database separation protects database-only compromise; it does not replace runtime least
  privilege. Hosted auth, recovery/notifications, administration, poll-result, and audit use
  separate service roles.
- Production, staging, test, and development use separate databases, credentials, network rules,
  keys, and external-provider projects.

### Email custody and delivery routing

- `powerotp_pii`: POWEROTP receives the email under its own notice, encrypts it in Supabase, stores
  its dedicated keyed lookup, and uses the existing Brevo email service for sign-up verification,
  email-code sign-in, security notifications, and recovery.
- `didit_pii`: Didit retains verified email/contact values on its persistent User entity. POWEROTP
  stores only the dedicated keyed email lookup and permanent Didit mapping. Didit's email
  verification flow sends and checks the email code for sign-up, email-code sign-in, and recovery.
- Provider routing never silently falls back across modes. Brevo is not used for a `didit_pii`
  identity's contact authentication, and Didit is not used for a `powerotp_pii` email login merely
  because the project also enables age, KYC, liveness, or biometric features.
- WebAuthn remains the preferred sign-in method in both modes and does not call either email
  provider.

### Project-scoped ID

At first successful binding, POWEROTP computes a versioned keyed value over the private person
and project IDs, encodes it as a non-enumerable public ID, and persists it:

`projectUserId = HMAC(versionedPepper, hostedPersonIdentityId || 0x00 || projectId)`

Persistence makes the public ID immutable across pepper rotation. The same private identity gets
a different ID at every project. No API, log, dashboard, export, or callback exposes the input
identity ID, the pepper, or another project's binding.

## 11. Canonical authentication-request and browser flows

### Client initiation and CSRF/state protection

1. The client backend calls POWEROTP with its project API key and an idempotency key.
2. The request chooses only `signup` or `signin` and no arbitrary return URL. POWEROTP assigns the
   fixed ten-minute active lifetime.
3. POWEROTP binds the request to the project's configured success/failure/recovery/restart URLs and
   returns `authRequestId`, `hostedUrl`, shown-once `pollToken`, `statusUrl`, and `expiresAt`.
4. The client stores `pollToken` server-side and redirects the browser only to `hostedUrl`.
5. POWEROTP sets a Secure, HttpOnly, host-only realm request cookie and uses a separate
   same-origin CSRF value for hosted mutations. Browser handle, request, project, realm, and flow
   must agree.
6. The browser return carries only `authRequestId` and an untrusted completion hint. It never carries
   `pollToken` or an authoritative authentication result.
7. The client backend polls with both its API key and poll token. Polling, not the browser redirect,
   is authoritative.

### Hosted URL resolution

- The opaque `identifierString` authorizes project resolution; `projectName` is presentation only.
- `projectName` in hosted paths is the same project slug used by project APIs; it is never an
  authorization secret.
- A request created for one project, flow, or return URL cannot be used at another.
- Disabled projects/services and unknown identifiers return a generic unavailable page.
- Direct visits without a valid request show an expiry/missing-request message and redirect only to
  the project's configured `restartUrl`; they never trust the browser `Referer`.
- URL fragments, userinfo, wildcard hosts, non-default-port ambiguity, encoded-host tricks, and
  production HTTP return URLs are rejected.

The Project card's signup/signin paths are configuration/marketing URLs only. A direct visit cannot
begin authentication. Client backends must first create an auth request and redirect only to the
returned ceremony `hostedUrl`, which contains an opaque browser request handle but never `pollToken`.

### Browser return routing

- Signup success → `signupReturnUrl`.
- Signin success → `signinReturnUrl`.
- Failed, declined, canceled, or `signup_required` outcome → `failureReturnUrl`.
- Completed recovery branch → `recoveryReturnUrl`.
- Missing/expired/direct request → `restartUrl`.

Return query parameters are `authRequestId` and
`hint=pending|succeeded|failed|signup_required|canceled|recovered`. Hints are presentation-only. The
client must poll and branch on authoritative `state`/`failureReason`.

### Cross-mode profile linking

POWEROTP never merges person roots from email equality alone:

1. The target realm verifies contact using its own custodian and computes the global keyed contact
   link hash plus the target-mode lookup.
2. When the global hash matches an existing person root, POWEROTP requires fresh authentication in
   one existing profile and issues a one-time cross-realm linking grant.
3. The target profile is attached to that person root only after both the target contact proof and
   existing-profile proof succeed.
4. Without existing-profile proof, signup creates a separate person root. A later explicit merge
   requires fresh authentication in both roots, migrates bindings/claims transactionally, and
   preserves an audit record.

### New-user sign-up

1. Resolve project branding and immutable data mode, then show the sign-up credential card.
2. Attempt fresh conditional WebAuthn discovery in the project's realm before collecting contact
   data. UI-only remembered-account cookies may suggest an account but never authenticate it.
3. When the realm profile is authenticated, do not create another person/profile/Didit User/contact
   record. Issue a one-time credential-management grant before the user explicitly adds a new-device
   passkey. Check required verification claims and create or reuse the project binding.
4. When no identity is recognized, show POWEROTP's identity/passkey privacy notice and obtain the
   exact hosted-identity consent before creating a pending person/profile.
5. Generate and verify WebAuthn registration for the exact target RP ID (`authx.powerotp.com` or
   `authz.powerotp.com`), with a random challenge, discoverable credential, required user
   verification, credential-ID uniqueness, and the selected attestation policy. Persist the
   realm-profile public credential before starting contact or provider qualification.
6. Collect the configured contact identifier and compute its keyed lookup. `powerotp_pii` may verify
   through Brevo email or enabled POWEROTP SMS/voice; `didit_pii` uses Didit email/phone only. An
   existing lookup requires mode-appropriate contact authentication and the defined explicit
   linking/merge proof before the pending credential can attach to an existing person root.
7. In `didit_pii`, create the permanent Didit User with `potpDiditId`, store the returned
   `diditInternalId`, and perform Didit email verification. In `powerotp_pii`, encrypt the email in
   Supabase and perform POWEROTP/Brevo email verification.
8. Perform only the project's missing required age/KYC/liveness enrollment steps. Reuse valid
    identity-level claims without purchasing a duplicate provider verification.
9. Missing, declined, abandoned, or expired qualification leaves the passkey and profile restricted,
   creates no successful project binding, and never exposes poll success. Retry resumes from fresh
   passkey authentication and the currently missing contact/claim step.
10. Create or idempotently reuse the immutable project binding, commit the identity saga, durably
    write the redacted retention record, expose the three-minute poll result, and redirect the
    browser to `signupReturnUrl`.
11. Failed or abandoned enrollment expires and is reconciled without deleting a valid passkey.
    Unusable provider artifacts and unverified contact attempts are cleaned independently; no
    unauthorized project binding survives.

### Returning sign-in

1. Present passkey conditional UI/autofill and a familiar contact field. `powerotp_pii` may offer
   Brevo email and enabled POWEROTP SMS/voice; `didit_pii` may offer Didit email/phone; configured
   Didit biometric authentication appears only after its Phase 11 adapter is ready.
2. Every project request requires fresh authentication. Remembered-account cookies improve UI only.
3. WebAuthn uses usernameless discovery with an empty `allowCredentials` list in the project's exact
   RP realm and does not call
   Didit or Brevo.
4. `powerotp_pii` email-code sign-in resolves the keyed lookup and sends/checks the code through
   POWEROTP's existing Brevo email service.
5. `didit_pii` email-code sign-in resolves the keyed lookup and performs Didit email verification
   for the mapped `potpDiditId`.
6. Didit biometric sign-in creates a fresh biometric-authentication session for the known
   `potpDiditId`; Didit reuses the User entity's approved stored face.
7. POWEROTP verifies the selected factor, credential/identity/project/risk status, and binding.
8. Reuse valid age/KYC claims. Trigger Didit only when a required claim is missing/stale or the user
   selected a Didit-backed authentication factor.
9. Durably write the redacted retention result, expose the authoritative three-minute poll result,
   and redirect the browser to the configured signin URL. A valid identity with no project binding
   returns `signup_required`; signin never creates a binding silently.

### Poll result and client linking

- Poll tokens contain at least 256 bits of entropy, are shown once, stored hashed, server-only, and
  bound to request/project/flow.
- Polling requires both the project API key and poll token. Pending responses reveal no identity.
- After any terminal outcome, the same authenticated poll returns the same terminal result
  idempotently for three minutes so a lost network response cannot lose the outcome.
- The durable redacted retention record is written before success becomes pollable.
- The response includes `projectUserId`, flow, authentication time, assurance methods, and only
  project-authorized booleans. It excludes contact data and global identifiers.
- After the three-minute result window, the runtime record, poll-token hash, and sensitive result are
  deleted while the retention record remains.
- On sign-up, the client atomically links `projectUserId` to one local account. On sign-in, it looks
  up that same ID and opens the local account. Duplicate or conflicting links require explicit
  client-side resolution; POWEROTP never chooses between local accounts.

## 12. Credentials, new devices, recovery, and session boundaries

POWEROTP never issues or controls a client website session.

### Multiple authenticators

- One authentication profile can hold multiple named passkeys: phone, laptop, synced passkey, and
  hardware key.
- Every signup/signin/qualification completion surface offers an explicit “add this device” or “add
  another device” action after fresh authentication. It never silently enrolls a device.
- Adding a credential requires a one-time credential-management grant issued after fresh
  authentication or completed recovery.
- A newly registered credential does not delete existing credentials.
- Credentials are revoked individually and record created, last-used, and revoked timestamps.
- The last usable credential cannot be removed unless another approved recovery path exists.

### New-device behavior

1. A synced passkey works on the new device without POWEROTP enrollment.
2. If the passkey is not synced but an enrolled device is available, native WebAuthn hybrid QR
   authenticates the realm profile. The user may then add the new device.
3. If no enrolled device is available, the user enters centralized POWEROTP recovery.
4. Desktop cards prominently offer “Continue on your phone” QR and also retain “Use this device.”
   A POWEROTP handoff QR may move the current Didit/recovery request to mobile; it is distinct from
   native WebAuthn hybrid QR and contains no poll token.
5. After mobile proof succeeds, mobile may enroll a mobile passkey and the original desktop may
   separately enroll a desktop passkey. Each registration requires an explicit browser/user action.
6. Adding a passkey restores future authentication for that mode profile across its project
   bindings. It does not create client sessions.

### Recovery

- Recovery is a state branch inside the current signin request, not a third public client flow.
- POWEROTP discovers the identity on its hosted page with generic responses that prevent account
  enumeration.
- `powerotp_pii` recovery sends/checks the email code through POWEROTP's existing Brevo service using
  the encrypted Supabase email.
- `didit_pii` recovery creates the configured Didit recovery workflow for the permanent
  `potpDiditId`; Didit's hosted UI performs the required email, phone, liveness, and face-match
  features and returns the signed decision.
- User-held one-time recovery codes may serve as an independent proof in either mode.
- Complete-lockout assurance policy is configurable centrally. Preferred immediate recovery uses
  two independent proofs or one verified channel plus a recovery code.
- A single-channel fallback, if enabled, requires a security delay, notifications to all verified
  channels, cancellation capability, strict risk review, and no silent credential revocation.
- Recovery proof completes before POWEROTP issues a one-time short-lived registration grant. The new
  passkey is created and verified only after that proof; it is never trusted before Didit/Brevo/
  SMS/voice/recovery-code verification succeeds.
- Successful recovery adds a credential to the current realm profile. Lost credentials remain
  visible for individual revocation.
- Client API keys, client IP allowlists, client local sessions, browser telemetry, and support claims
  cannot by themselves authorize recovery.
- Passwords are not introduced as a weaker recovery fallback in v1.

### Session separation

- Hosted request session: fixed ten-minute active lifetime, one project/realm/flow, unusable after
  terminal state except for the three-minute server poll-result window.
- Credential-management grant: one-time and short-lived after fresh authentication/recovery, scoped
  only to adding/naming/revoking credentials in the current realm profile.
- Remembered-account cookie: presentation only; never satisfies authentication.
- Client session: owned entirely by the client and keyed to its local account/project user ID.
- Poll token: server-only request result credential, never a browser or identity session.
- Didit session: provider-purpose token, never interchangeable with any POWEROTP session.

## 13. Optional Didit, consent, privacy, and retention

- Didit provides five separately configured capabilities: contact email/phone verification, age
  verification, KYC, liveness/face enrollment, and fresh biometric authentication. They have
  separate prices, consent, retention, validity, and recheck rules.
- `didit_pii` always uses Didit for contact email authentication. `powerotp_pii` uses Brevo for
  contact authentication and calls Didit only for enabled age/KYC/liveness/biometric capabilities.
- Didit-backed email/phone OTP uses POWEROTP's branded contact UI over Didit's APIs. End-user
  age/KYC/document/liveness/face-match/biometric/recovery capture uses a backend-created Didit
  session opened through `@didit-protocol/sdk-web`: modal on desktop and full viewport on
  mobile/PWA. Cross-device QR remains available, and camera/iframe incompatibility falls back to the
  same session's top-level Didit redirect.
- POWEROTP's page retains its own logo, consent, progress, navigation, and project branding around
  Didit's standard branded provider UI. POWEROTP does not enable or price the optional Didit
  white-label feature merely to achieve this co-branded shell.
- For `didit_pii`, POWEROTP creates the persistent Didit User during contact-profile enrollment.
  For `powerotp_pii`, it creates that User only when the person first uses a Didit capability.
  Both paths send the person-root `potpDiditId` as `vendor_data`, store the returned
  `diditInternalId`, and reuse that mapping for every later Didit session.
- POWEROTP is the disclosed controller for the reusable hosted identity purpose; Didit is named as
  the verification provider before biometric capture.
- Explicit consent records the exact text/policy version, locale, timestamp, and affirmative action.
- The provider is accessed through an internal vendor-neutral verification interface. No Didit SDK
  type appears in the public client API.
- Signed provider callbacks are timestamp checked, replay protected, ordered, and reconciled.
- Didit-returned PII, documents, selfies, liveness media, biometric templates, and full decisions
  never reach POWEROTP clients and are not stored in POWEROTP databases. POWEROTP retains only its
  opaque person mapping, provider session/evidence references, normalized claims, and audit/billing
  linkage.
- Projects that do not enable Didit biometric authentication use the capability's approved finite
  provider retention and deletion policy. POWEROTP's evidence references remain auditable only
  while Didit lawfully retains the underlying record; provider deletion is retried and reconciled.
- Enabling Didit biometric authentication explicitly retains the approved face on the persistent
  Didit User for later fresh liveness/face-match sessions. Its consent and retention policy is
  therefore different from the finite age/KYC evidence-retention policy.
- POWEROTP stores reusable identity-level verification claims with source, method, verified time,
  expiry, policy version, and threshold result. It does not treat a past biometric-authentication
  event as proof of present user presence.
- A later project in either realm reuses a still-valid person-level age/KYC claim and is charged the
  configured reuse rate without
  purchasing another Didit verification. A new Didit verification runs only when the required claim
  is absent, stale, or cannot satisfy the new policy.
- In either custody mode, POWEROTP may retrieve verified DOB transiently from the Didit User/session
  to derive a new threshold-specific result without storing DOB. Client responses contain only
  authorized outcomes such as `ageRequirementMet`.
- Basic KYC is one Didit workflow containing ID/OCR, passive liveness, and face match with no
  Device/IP Analysis. Its observed current feature sum is USD 0.30 after free allowances, but code
  never hardcodes provider pricing.
- Document age is a separate ID Verification workflow. Its observed current provider price is
  USD 0.15. The verified DOB remains at Didit; POWEROTP transiently evaluates the project's
  arbitrary threshold and stores only the resulting reusable claim.
- Liveness, face/NFC, biometric authentication, and future Didit modules remain independently
  selectable by project policy and attach to the same person-level Didit User mapping.
- Underage and indeterminate outcomes fail closed for the requested policy.
- Identity deletion crypto-shreds its DEK after the approved account-retention period and separately
  handles legally required non-biometric audit evidence.
- Final consent copy, retention periods, children/minor handling, and controller language require
  counsel approval before production.

## 14. Required API contracts

All project management and server integration routes use:

- `Authorization: Bearer <project-api-key>`
- `Idempotency-Key` on create/replace/send operations
- `Cache-Control: no-store` on sensitive responses
- Correlation IDs and stable machine-readable errors
- Optional project backend IP/CIDR allowlist as defense in depth; it never replaces the API key

### Create authentication request

`POST /v1/projects/{projectSlug}/auth-requests`

Request:

```json
{
  "flow": "signup"
}
```

Response:

```json
{
  "authRequestId": "har_...",
  "hostedUrl": "https://authx.powerotp.com/signup/project/opaque?request=...",
  "pollToken": "<shown-once-server-secret>",
  "statusUrl": "https://api.powerotp.com/v1/projects/project/auth-requests/har_...",
  "expiresAt": "..."
}
```

POWEROTP sets `expiresAt` to exactly ten minutes after request creation. Clients cannot configure
the active ceremony lifetime. The response's poll token is server-only and never copied into the
hosted URL or browser.

### Poll authentication request

`GET /v1/projects/{projectSlug}/auth-requests/{authRequestId}`

Headers:

```text
Authorization: Bearer <project-api-key>
x-auth-request-token: <pollToken>
```

Pending response:

```json
{
  "authRequestId": "har_...",
  "state": "awaiting_user",
  "expiresAt": "..."
}
```

Successful response:

```json
{
  "authRequestId": "har_...",
  "state": "succeeded",
  "projectUserId": "pusr_...",
  "flow": "signup",
  "authenticatedAt": "...",
  "completedAt": "...",
  "assuranceMethods": ["webauthn"],
  "verification": { "ageRequirementMet": true },
  "resultExpiresAt": "..."
}
```

Terminal non-success response:

```json
{
  "authRequestId": "har_...",
  "state": "failed",
  "failureReason": "signup_required",
  "completedAt": "...",
  "resultExpiresAt": "..."
}
```

Pending and failed polls never reveal an identity. Every terminal result (`succeeded`, `failed`,
`canceled`, or `expired`) is idempotently readable until `resultExpiresAt`, exactly three minutes
after `completedAt`; then the runtime record/poll token/result are deleted. Clients stop polling on
any terminal state. Omit verification fields the project did not request. Never return null-shaped
PII fields.

### Hosted ceremony route families

- Same-origin request status/cancel routes.
- Registration options/verification routes.
- Authentication options/verification routes.
- Signin recovery-state discovery, send, verify, delay/cancel, mobile-handoff, and credential-add
  routes.
- Credential list/name/add/revoke routes.
- Didit start/return/status routes plus private signed provider webhook.
- `POST /v1/projects/{projectSlug}/auth-requests/{authRequestId}/cancel` — project API key plus poll
  token; idempotently transitions only non-terminal requests.

Hosted browser routes use realm request cookies and CSRF protection, never project API keys or poll
tokens.

### Project authentication settings and URLs

- Customer project creation requires immutable `identityDataMode`.
- `GET|PATCH /v1/projects/{projectSlug}/auth-settings`
- `GET|PUT /v1/projects/{projectSlug}/auth-return-urls`
- Settings include signup/signin enablement, method policy, age/KYC/liveness/biometric policy, and
  optional backend IP/CIDR allowlist.
- Return settings contain exact HTTPS `signupReturnUrl`, `signinReturnUrl`, `failureReturnUrl`,
  `recoveryReturnUrl`, and `restartUrl`.

### Project settings and Template 1 API

- `GET /v1/projects/{projectSlug}/auth-pages/{signup|signin}`
- `PUT /v1/projects/{projectSlug}/auth-pages/{signup|signin}/selected-template`
- `PATCH .../templates/{templateType}/rows/{A..F}/text`
- `PUT|DELETE .../templates/{templateType}/rows/{A..F}/image`
- `PATCH .../templates/{templateType}/rows/{A..F}`
- `PATCH .../templates/{templateType}/ad-positions/{1..6}`

Text updates accept only the versioned structured rich-text schema. Image replacement accepts a
file, validates actual type/size/dimensions, strips metadata, re-encodes it, uploads it to
POWEROTP's Bunny-backed CDN, atomically switches the row, and then deletes the superseded row asset.
Failure leaves the existing image active.

### Paid-factor execution

- Before email/SMS/voice/Didit work, compare prepaid balance with the selected method's configured
  price and use the existing balance transaction service to reserve/debit it.
- Link the existing POWEROTP verification interaction or Didit session ID to `authRequestId`.
- WebAuthn is preferred and has no provider charge.
- In `powerotp_pii`, insufficient SMS/voice balance may offer enabled Brevo email only when project
  authentication policy explicitly permits that assurance downgrade; otherwise fail closed.
- `didit_pii` never falls back to Brevo. Required paid assurance with insufficient balance returns
  `insufficient_balance`; it is never bypassed.
- No new spend-limit subsystem is introduced; clients manage prepaid balance.

Stable errors cover invalid project, disabled service, invalid return URL, expired/canceled request,
invalid poll token, expired result, idempotency conflict, verification required/declined,
`signup_required`, `insufficient_balance`, recovery delay, image validation, template/row conflict,
authentication failure, and rate limiting.

## 15. Project-card and Template 1 administrator UX

The Project card remains the single administrator surface and shows four separate service areas:
sign-in, sign-up, BotBlocker, and Didit. Changes in one do not silently change another.

### Separate sign-up and sign-in controls

Each has its own:

- Enabled/status control
- Generated hosted URL
- Exact named return URLs
- Template dropdown
- Template edit button
- Saved template records
- Six ad-position toggles
- Recovery/verification policy display
- Recent configuration/security events

Selecting a template immediately loads its previously saved content. Switching away does not delete
it. The edit button opens the modal belonging to the selected template type.

### Template 1 modal

- Shows Rows A–F and all six ad toggles.
- Rows A/C/E display image-left/text-right; B/D/F display text-left/image-right.
- Each row has enabled, image replacement/removal, alt text, and a safe rich-text editor.
- The editor offers approved fonts, bounded sizes, paragraphs, bold, italic, underline, and lists.
- Each item saves independently and updates only that page/template/item.
- No raw HTML, CSS, scripts, remote image URLs, arbitrary fonts, layout code, or executable embeds.
- Sign-up and sign-in use duplicate Template 1 layout editors for MVP but save to separate entities
  and render different fixed credential-card functions.
- Mobile uses the separate floating-card/scrolling-background renderer defined in §4.

### Ads

Positions 1–6 are fixed after Rows A–F. Each position is independently enabled. Disabled positions
and enabled positions with no provider fill render at zero height. Provider fill may make an enabled
slot appear, but cannot reorder rows, cover the credential card, or execute third-party scripts.

## 16. Existing public MCP instructions

The existing `powerotp-integration-guide` MCP gains a hosted-auth provider section only. It remains
anonymous, credential-free, project-unaware, read-only, and idempotent.

Public tools/resources:

- `get_signup_provider_guide`
- `get_signin_provider_guide`
- `get_auth_provider_project_setup`
- `get_template1_guide`
- `generate_auth_provider_example`
- `get_auth_provider_troubleshooting`

They provide professional customer-facing explanations, generic schemas, placeholder-only
curl/TypeScript examples, and setup/troubleshooting instructions. They explain where to obtain the
project ID/API key and instruct customers to keep the key in their server secret store and call the
normal project API. They never accept credentials/project IDs, contact a project, return project
settings, upload assets, or mutate anything.

## 17. Failure, replay, timeout, duplicate, and abuse rules

- Auth requests, poll tokens, WebAuthn challenges, recovery attempts, Didit sessions, and hosted
  cookies have distinct scopes and TTLs.
- Terminal request states (`succeeded`, `failed`, `expired`, `canceled`) are immutable.
- Refresh/back/concurrent tabs may read current state but cannot replay a completed ceremony.
- Every WebAuthn challenge is random, request-bound, short-lived, and consumed once.
- Poll-token verification is constant-time. Only the API-key/poll-token pair can read a result.
- Idempotency keys are scoped to project/operation and bound to a request hash; changed payloads
  return conflict.
- Cancellation never returns a success-shaped result. Retry starts a new challenge or auth request
  where required rather than reviving consumed material.
- Simple rate limits layer project, IP, auth request, identity lookup, credential, recovery
  destination, and channel. Prepaid balance is the cost control; no separate spend-limit subsystem
  is added.
- Recovery and sign-in responses resist identity/credential enumeration.
- Direct-sold ads and client content run no scripts on credential pages. Strict CSP, frame-ancestors,
  Referrer-Policy, permissions policy, MIME enforcement, and no-sniff headers are required.
- API keys, poll tokens, challenges, cookies, PII, credential IDs, Didit secrets, and KMS material
  are redacted from logs.
- The durable auth-request retention row is the canonical login/signup audit record. Separate events
  cover credential, key, return-URL, template, image, ad-toggle, deletion, and privileged-support
  changes.

## 18. Dependency-ordered development roadmap

Every phase is split into fresh-session execution steps. Each step must be estimated to use no more
than 20% of a fresh context window including discovery, implementation, focused verification,
AS-BUILT update, commit/push, remote CI confirmation, and handoff. Split a step again before editing
if it cannot fit. Do not stop midway through an operation that leaves the branch inconsistent.

### Phase 0 — Boundaries and threat model

Steps:

- P0-S1: lock glossary, product boundaries, person-root/profile model, `authx`/`authz` RP isolation,
  and Passport/BotBlocker separation.
- P0-S2: data classification, contact custody, trust boundaries, abuse cases, and deletion owners.
- P0-S3: consent purposes, certification wording, Didit/vendor gates, and prohibited claims.
- P0-S4: add hosted-auth assets, threats, and mitigations to `docs/THREAT_MODEL.md`.

Acceptance: every data class has owner/store/exposure/retention/deletion rules; no client contract
contains PII/global IDs; both realms and all cross-profile linking rules are deterministic.

Focused tests/review: cross-project linkage, open redirect, client-authorized global reset,
cross-realm credential/cookie use, database-only compromise, runtime compromise, and BotBlocker
boundary review.

### Phase 1 — Contracts and state machines

Steps:

- P1-S1: person/profile/project-binding/Didit/auth-request/poll-token identifier schemas.
- P1-S2: auth-request, polling, WebAuthn, contact, recovery, credential-grant, and verification state
  machines.
- P1-S3: vendor-neutral email/phone/Didit interfaces and balance-operation contract.
- P1-S4: stable errors, active/result TTLs, idempotency, compatibility versions, and PWA-safe route
  contracts that do not assume a normal browser tab.

Acceptance: terminal states are immutable; every transition/retry/cancel/duplicate path is defined;
identifiers are opaque and non-enumerable.

Focused tests: strict schema rejection, illegal transitions, changed-payload idempotency conflicts,
unknown enum/version handling, and TTL boundaries.

### Phase 2 — Identity, runtime, retention, and cryptography

Steps:

- P2-S1: per-environment Supabase bootstrap, migration pipeline, connectivity, RLS/service roles, and
  person/profile/credential/contact/consent/verification schema.
- P2-S2: minimal hot auth-request repository, TTLs, encrypted result, and poll-token hashing.
- P2-S3: separate durable auth-request retention database and write-before-publish rule.
- P2-S4: project binding, wrapped-key, template, and non-request security-event schemas.
- P2-S5: per-person DEK, AEAD associated-data envelope, KMS integration, and wrapped-key persistence.
- P2-S6: project-user-ID pepper derivation, keyed lookup secrets, and key rotation.
- P2-S7: person/profile/contact creation saga and compensation.
- P2-S8: reconciliation workers and orphan detection.
- P2-S9: retention/deletion/Didit cleanup orchestration.
- P2-S10: crypto-shredding and backup/restore behavior.

Acceptance: neither database alone decrypts PII; partial creation is recovered/cleaned; bindings are
unique; hot-result deletion cannot delete audit evidence; runtime store remains portable.

Focused tests: AEAD/AAD swapping, KMS denial, key rotation, RLS/project denial, orphan reconciliation,
backup/restore, retention, and crypto-shredding.

### Phase 3 — Project configuration

Steps:

- P3-S0: provision `authx`/`authz` DNS, TLS, host routing/deployment configuration, health checks,
  environment separation, and CI deploy paths.
- P3-S1: required immutable `identityDataMode`, `identifierString`, auth realm, RP ID, and generated
  hosted URLs on project creation.
- P3-S2: exact signup/signin/failure/recovery/restart URLs and method/assurance settings.
- P3-S3: optional backend IP/CIDR allowlist.
- P3-S4: Project-card service controls, mode badge/explanation, URLs, balance visibility, and audit
  history; template controls remain disabled until Phase 5 supplies them.

Acceptance: exact production HTTPS URLs only; sign-up/sign-in/BotBlocker/Didit remain independent;
serverless clients can operate without IP restrictions; every customer project has exactly one
immutable contact-custody mode. The internal landing-page verification demo is not a customer
project or hosted-auth service.

Focused tests: URL canonicalization bypasses, fragments/userinfo/ports, IPv4/IPv6 CIDRs, project
authorization, and setting-isolation tests.

### Phase 4 — Contact-provider foundations

Steps:

- P4-S1: purpose-separated hosted-auth adapter over existing Brevo email service.
- P4-S2: hosted-auth adapters over existing SMS and voice verification infrastructure.
- P4-S3: Didit environment/config validation for `DIDIT_API_KEY`,
  `DIDIT_EMAIL_WORKFLOW_ID`, `DIDIT_PHONE_WORKFLOW_ID`, `DIDIT_RECOVERY_WORKFLOW_ID`,
  `DIDIT_AGE_WORKFLOW_ID`, `DIDIT_KYC_WORKFLOW_ID`, `DIDIT_LIVENESS_WORKFLOW_ID`,
  `DIDIT_BIOMETRIC_AUTH_WORKFLOW_ID`, and `DIDIT_WEBHOOK_SECRET`, without writing or replacing
  `.env` unless explicitly authorized.
- P4-S4: persistent Didit User creation and exact person-root mapping.
- P4-S5: Didit email/phone contact verification APIs with POWEROTP-branded UI contract.
- P4-S6: minimum signed webhook verification and replay/order handling.
- P4-S7: provider polling reconciliation and outage behavior.
- P4-S8: purpose-specific Didit Sessions API adapters for document age, no-IP basic KYC
  (ID/OCR + passive liveness + face match), and liveness; validate exact workflow graph,
  returned-data policy, environment, person-level `vendor_data`, and computed provider price without
  persisting provider PII or starting a browser ceremony.
- P4-S9: provider-reference-backed reusable claim persistence/evaluation, transient DOB threshold
  derivation, expiry/recheck policy, and per-project reuse charging needed to complete signup.

Acceptance: `powerotp_pii` routes contact only through POWEROTP providers; `didit_pii` routes contact
only through Didit; WebAuthn calls neither; required signup assurance has real adapters and never a
stub-success path. Either custody mode can invoke optional Didit assurance against the same
person-level mapping; basic KYC contains no Device/IP Analysis; provider PII/media remains at Didit.

Focused tests: provider-routing matrix, purpose tags, duplicate Didit User retry, webhook
forgery/replay/order, provider outage, exact workflow/price/environment binding, no-IP KYC,
document-age transient threshold derivation, provider-PII non-persistence, balance
race/insufficiency, reuse charging, and interaction linkage.

### Phase 5 — Template 1 content and renderers

Steps:

- P5-S1: per-project/page/template persistence and selector.
- P5-S2: structured rich-text schema and safe server renderer.
- P5-S3: rich-text editor UI.
- P5-S4: Bunny environment/connectivity validation, image replacement/removal lifecycle, and no
  `.env` mutation without authorization.
- P5-S5: six fill-sensitive ad positions with permanent empty-fill behavior.
- P5-S6: POWEROTP evergreen security/FAQ content registry.
- P5-S7: accessible POWEROTP-owned education carousel, arrows, and pagination dots.
- P5-S8: desktop 65/35 row/ad renderer.
- P5-S9: desktop credential/education card positioning and responsive boundaries.
- P5-S10: mobile row/image/text-expander/ad background renderer.
- P5-S11: mobile floating-card/dots/arrows/safe-area/keyboard behavior.
- P5-S12: manually reviewed creative storage/serving, project genre selection, and empty-fill API;
  self-serve advertiser intake/Stripe waits for the §7 pricing decision.
- P5-S13: sign-up settings modal and item APIs.
- P5-S14: sign-in settings modal and item APIs.
- P5-S15: Project-card template selector/edit controls.

Acceptance: item saves affect only their target; templates retain content; desktop/mobile visual code
is separate but security logic is shared; failed image changes preserve old assets; empty ads consume
no space.

Focused tests: cross-project access, image bombs/type/metadata, rich-text injection/font bounds,
accessibility, all 0–6 ad combinations, mobile safe-area/keyboard/scroll behavior, atomic image swap,
concurrent edits, template switching, and sign-up/sign-in modal isolation.

### Phase 6 — Auth request, hosted shell, polling, and baseline security

Steps:

- P6-S1: create-auth-request API, shown-once poll token, fixed ten-minute lifetime, and idempotency.
- P6-S2: realm/project/flow resolver and shared credential-card state-machine host.
- P6-S3: Template 1 desktop/mobile mounting around the shared card host.
- P6-S4: realm request cookie, browser handle, CSRF, and no-cache behavior.
- P6-S5: existing balance check/debit plus verification/Didit interaction linkage to real
  `authRequestId`.
- P6-S6: authenticated pending/terminal polling and three-minute result deletion.
- P6-S7: configured success/failure/recovery/restart browser routing and UX-only hints.
- P6-S8: cancellation and active/terminal timeout behavior.
- P6-S9: refresh/back, concurrent-tab, duplicate-create, and retry behavior.
- P6-S10: baseline CSP/security headers, request/IP/project/identity-lookup/recovery-destination
  limits, baseline secret redaction, and service-worker no-cache boundaries.
- P6-S11: Didit Web SDK host boundary with desktop modal, mobile/PWA full-viewport presentation,
  cross-device QR continuity, top-level redirect fallback, co-branded POWEROTP shell, and
  non-authoritative browser callbacks.

Acceptance: browser never receives poll token/API key; polling is authoritative; durable retention
precedes success; direct entry cannot open-redirect; sensitive responses cannot be cached.

Focused tests: token theft/replay, wrong project/key, response loss, TTL boundaries, session fixation,
open redirect, realm mismatch, concurrent tabs, duplicate create, CSP, cache and service-worker
inspection, SDK callback forgery, camera denial/iframe fallback, cross-device completion, and proof
that the browser receives neither API key nor authoritative provider result.

### Phase 7 — Sign-up

Steps:

- P7-S1: fresh realm WebAuthn discovery and existing-profile branch.
- P7-S2: hosted-identity/passkey notice, consent, and pending person/profile saga.
- P7-S3: realm-specific WebAuthn registration options.
- P7-S4: registration verification and restricted credential persistence.
- P7-S5: mode-specific email lookup, root/profile duplicate prevention, and explicit pending-
  credential linking rules.
- P7-S6: cross-mode candidate detection, existing-profile proof, and one-time linking grant.
- P7-S7: `powerotp_pii` contact enrollment through Brevo/SMS/voice policy.
- P7-S8: `didit_pii` contact enrollment and permanent Didit mapping.
- P7-S9: required reusable-claim check/provider branch without revoking the passkey on an
  unsatisfied qualification.
- P7-S10: idempotent authorized project binding and saga commit.
- P7-S11: retention write and poll-result publication.
- P7-S12: compensation/cleanup for contact, provider, claim, and binding failures while preserving
  every otherwise-valid restricted passkey/profile.

Acceptance: one person can hold both isolated profiles without duplicate root/Didit User; private
keys remain in authenticators; passkey registration precedes contact/qualification; failed or
missing qualification cannot authorize a project and cannot delete the valid passkey; repeat signup
returns the same binding; partial work is reconciled.

Focused tests: both-mode matrix, existing root/missing profile, challenge replay, wrong RP/origin,
duplicate credential, repeat signup, provider failure, restricted profile after required-claim
failure, retry after fresh passkey authentication, consent-before-registration, pending-credential
linking, cleanup without credential deletion, and cross-project IDs.

### Phase 8 — Sign-in

Steps:

- P8-S1: conditional/local WebAuthn options.
- P8-S2: assertion verification/counter/backup/credential status.
- P8-S3: realm-scoped remembered-account presentation cookie set/update/clear rules with no
  authentication authority.
- P8-S4: `powerotp_pii` Brevo/SMS/voice fallback.
- P8-S5: `didit_pii` email/phone fallback.
- P8-S6: missing-binding `signup_required`, repeat project authentication, risk/claim policy.
- P8-S7: retention/result publication and configured browser return.

Acceptance: every project visit performs fresh proof; cookies never authenticate; wrong-realm
credentials fail; result contains only project ID and allowed assurances.

Focused tests: assertion replay, unknown/revoked credential, wrong realm/RP/origin/challenge, counter
anomaly, both-mode fallbacks, no binding, suspended identity, claim reuse, balance fallback, and logs.

### Phase 9 — Client polling, account linking, and sessions

Steps:

- P9-S1: complete authenticated poll contract and generated server examples.
- P9-S2: first signup local-link contract.
- P9-S3: returning lookup/open-account contract.
- P9-S4: duplicate/conflict/relink/unlink/delete behavior.
- P9-S5: explicit client-owned session/refresh/logout guidance and end-to-end sample.

Acceptance: clients persist only project user IDs; projects cannot query other bindings; client
session expiry/logout does not alter POWEROTP identity; POWEROTP issues no client refresh token.

Focused tests: three-minute result polling/loss/expiry, duplicate browser returns, concurrent first
link, local-account conflict, stale client session, unlink/relink authorization, and deleted binding.

### Phase 10 — Multiple authenticators, QR, and recovery

Steps:

- P10-S1: credential list/name/add and one-time credential-management grants.
- P10-S2: recovery-code generation, one-time display, hashing, consumption, and reissue.
- P10-S3: native hybrid QR authentication.
- P10-S4: single-use mobile handoff QR for Didit/recovery.
- P10-S5: individual revocation and last-credential protections.
- P10-S6: signin recovery-state initiation and enumeration-resistant discovery.
- P10-S7: `powerotp_pii` Brevo/SMS/voice/recovery-code proof.
- P10-S8: `didit_pii` email/phone recovery proof.
- P10-S9: delay/notification/cancel/risk policy.
- P10-S10: post-proof mobile/desktop passkey registration and lost-credential review.
- P10-S11: recovery browser routing to `recoveryReturnUrl` and terminal failure routing.

Acceptance: clients never receive PII or authorize credential changes; recovery does not alter
project bindings; no new passkey is trusted before proof; realm credentials remain isolated.

Focused tests: enumeration, brute force/replay, resend pumping, destination substitution, recovery
code replay/reissue, token and QR theft/replay/timeout, mobile-to-desktop handoff, user-gesture
registration, delayed cancellation, last credential, and compromised-client initiation.

### Phase 11 — Optional Didit assurance and reusable claims

Steps:

- P11-S1: fresh biometric-authentication adapter.
- P11-S2: biometric signin and biometric recovery branches.
- P11-S3: Didit Web SDK biometric UX on desktop/mobile/PWA using the shared Phase 6 modal,
  full-viewport, cross-device, and redirect-fallback boundary.
- P11-S4: person-level claim derivation and threshold evaluation.
- P11-S5: claim expiry/policy evaluation.
- P11-S6: cross-client reuse charging and retention linkage.
- P11-S7: capability-specific finite session/evidence retention, deletion, and retry.
- P11-S8: retained-face policy and consent enforcement.
- P11-S9: Didit User deletion and evidence reconciliation.

Acceptance: no provider PII/media/full evidence reaches POWEROTP storage or clients; completion is
durable; valid policy results are reusable; retained faces exist at Didit only under biometric-auth
consent; deletion failures are visible.

Focused tests: biometric wrong-user/liveness/face failure, forged/replayed/out-of-order webhook,
cancellation, outage, threshold/expiry change, underage fail-closed, reuse charging race, deletion
retry, retained-face consent, and provider adapter contract.

### Phase 12 — Public MCP hosted-auth instructions

Steps:

- P12-S1: sign-up provider guide and examples.
- P12-S2: sign-in/polling/client-session guide and examples.
- P12-S3: project setup, URLs, custody modes, methods, and balance guidance.
- P12-S4: Template 1 desktop/mobile/design API guide.
- P12-S5: recovery, QR, Didit assurance, and reusable-claim guidance.
- P12-S6: troubleshooting and local request-shape validators.

Acceptance: existing MCP remains public, anonymous, read-only, credential-free, and project-unaware;
all examples match completed APIs and contain placeholders only.

Focused tests: MCP annotations, no project network access, schema/example compilation, secret scans,
and separation from BotBlocker instructions.

### Phase 13 — Abuse, audit, and operational security

Steps:

- P13-S1: distributed versions of the simple baseline rate limits.
- P13-S2: retention/result purge monitoring and durable audit reconciliation.
- P13-S3: full secret/PII redaction and non-request security events.
- P13-S4: provider outage, balance reconciliation, alerts, and privileged support controls.

Acceptance: all sensitive changes are attributable; secrets/PII are redacted; content/ads cannot
execute code or obscure credentials.

Focused tests: distributed limits, log scan, CSP violations, malicious content/creative, audit
tampering, support denial, and network-allowlist failures.

### Phase 14 — Rollout and evidence readiness

Steps:

- P14-S1: desktop/mobile browser, authenticator, both-realm, method, polling, recovery, and
  assurance compatibility matrix.
- P14-S2: create fresh synthetic projects in both custody modes and run an allowlisted canary before
  regulated production PII.
- P14-S3: backup/restore/rollback/key-rotation rehearsal.
- P14-S4: operational evidence and release-readiness review.

Acceptance: existing dashboard auth, verification APIs, accounting, and BotBlocker remain unchanged;
rollback does not orphan people/profiles/requests/results; production claims use approved wording.

Focused tests: staging end-to-end matrix, fresh-project provisioning, load/races, regional/network
failure, backup restore, canary rollback, and evidence review.

### Phase 15 — Installable PWA and push approval

The browser implementation is kept PWA-compatible from Phases 1, 5, and 6, but installability and
push are deliberately the last product phase.

Steps:

- P15-S1: separate `authx` and `authz` manifests, icons, install UX, standalone navigation, and
  mode-specific display names.
- P15-S2: service workers that cache only immutable public shell/education assets and explicitly
  exclude auth pages, API responses, PII, poll tokens, Didit secrets, and results.
- P15-S3: realm-specific Web Push subscription, consent, revocation, and device management.
- P15-S4: push “approve sign-in” deep link that always opens the exact auth request and still
  requires WebAuthn/user verification; push delivery alone never authenticates.
- P15-S5: QR/deep-link handoff into installed standalone mode and return to the originating browser
  request.
- P15-S6: installed-PWA compatibility, notification loss, offline, upgrade, cache purge, and
  uninstall/re-enrollment testing.

Acceptance: both PWAs preserve RP/cookie isolation; no sensitive material enters caches or push
payloads; push reduces provider use without weakening WebAuthn; browser flows remain fully supported.

Focused tests: install/update on iOS/Android/desktop, service-worker cache inspection, compromised
push payload, revoked subscription, missed/delayed notification, cross-realm deep-link denial,
offline failure, and browser/PWA handoff.

## 19. Development record and session protocol

Use one cumulative file for the entire implementation:

`docs/POWEROTP_SIGNIN_AD_SERVICE_AS_BUILT.md`

Update it after every execution step. Entries are append-only:

`## YYYY-MM-DD HH:mm UTC — P{phase}-S{step}: <title>`

Each entry records scope, evidence, implemented behavior, affected files/contracts/routes/data/UI,
new findings, directional changes and rationale, security/migration impact, deviations, focused
tests/results, known limits, commit/push status, and next step. Maintain a phase/step index near the
top so future sessions can read only relevant history.

Every step follows this completion order:

1. Read this plan and the cumulative AS-BUILT index/relevant entries.
2. Implement only the active step.
3. Run focused verification once, proportional to the change.
4. Append the AS-BUILT entry and update its index.
5. Review, commit, and push the coherent step.
6. Check required remote CI/result once.
7. If CI fails, fix within the same step, append the finding, commit/push, and recheck.
8. After remote green, print the next-session start prompt as the final operation.

If commit/push is not authorized, stop before handoff and report that authorization is required.
Never generate the handoff after local verification alone. Nothing runs or changes after the handoff.

The handoff includes repository/branch/commit/PR/remote status; completed and excluded scope; this
plan and relevant AS-BUILT anchors; source/contracts/routes/data/UI/tests/config names; decisions and
findings; verification; environment/manual actions; and the next step with acceptance/tests and the
20% context limit.

## 20. Explicit security and privacy invariants

- Clients never receive PII, encrypted PII, decryption keys, WebAuthn material, Didit evidence, or a
  global identity ID.
- Encryption reduces breach exposure but does not make PII anonymous.
- Client initiation is never identity-recovery authorization.
- Browser code never contains project API keys.
- Challenges, browser handles, cookies, poll tokens, recovery grants, and provider sessions are
  purpose-specific and never interchangeable.
- Project-scoped IDs are stable within one project and unlinkable across projects.
- Credential changes do not silently change project bindings or client accounts.
- Database access is network restricted and least privilege; optional client IP allowlists supplement
  rather than replace API authentication.
- Customer content is structured and validated; images are re-encoded/re-hosted; auth pages execute
  no client or third-party scripts.
- Existing MCP remains anonymous/read-only/project-unaware.
- BotBlocker plans and iframe behavior are unchanged.
- Approved wording is “designed to align with ISO/IEC 27001 controls” and “uses infrastructure
  providers whose applicable services are certified.” POWEROTP must not claim its own ISO 27001,
  SOC 2, or HIPAA compliance before completing the applicable contracts, controls, evidence, and
  independent assessment.

## 21. Deferred items and unresolved decisions

- Final complete-lockout proof combinations, cooldown duration, and manual-support policy.
- Counsel-approved consent, privacy, biometric, retention, children/minor, controller, and
  international-transfer language.
- Didit contractual carve-out, retention configuration, model-training opt-out, vendor exit, and
  second-provider selection.
- Future hosted-auth-to-Passport link semantics; no automatic merge in this scope.
- Wallet/mDL, mTLS, enterprise federation, and additional authenticator policy controls.
- Templates beyond Template 1. The saved-per-template data/selector/modal contract is established,
  but no other template is implemented in MVP.
- Ad pricing/measurement and future provider selection. They cannot weaken credential-page controls.
- Password fallback, client PII release, custom QR, cross-site cookies, remote image hotlinks,
  customer HTML/CSS/JavaScript, and third-party auth-page scripts remain excluded.
