# POWEROTP Sign-In as a Service — hosted credential pages plan

Proposed direction for POWEROTP's primary hosted credential service: passwordless/WebAuthn
sign-up, repeat sign-in, and optional hosted age/identity verification, with advertising used to
subsidize the hosted pages. This document describes intended direction only; it is not a record
of what is deployed.

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
WebAuthn credential, or age/identity evidence. POWEROTP authenticates the user and returns only a
short-lived result that the client's backend exchanges for a stable, project-scoped user ID. The
client stores that project-scoped ID with its local account so the same person can sign in later
through POWEROTP without exposing a global cross-site identifier.

---

## 1. Hosted credential-service model

The client website redirects the browser to a dedicated POWEROTP page for sign-up, sign-in, or
configured age/identity verification. This gives POWEROTP a first-party, top-level security
context in which to register or use WebAuthn credentials and maintain the authentication
transaction. It also gives each client a branded, crawlable page whose content and fixed ad
locations POWEROTP controls.

This hosted-page decision applies only to the credential and identity services in this document.
It says nothing about whether an iframe is appropriate for the separate BotBlocker OTP challenge.

## 2. Hosted URLs and credential flows

Project creation mints an opaque, non-guessable `identifierString`. The project receives separate
hosted entry points under the POWEROTP domain:

- `https://powerotp.com/signup/{projectName}/{identifierString}`
- `https://powerotp.com/signin/{projectName}/{identifierString}`

The readable project name is branding and routing context only. Authorization depends on the
opaque identifier and server-side project state, never on a guessable project-name slug.

### Sign-up

1. The client website redirects the browser to its hosted sign-up URL.
2. POWEROTP creates or resolves the user's private identity record, registers the passwordless
   WebAuthn credential, and performs Didit age/identity verification when the project's service
   configuration requires it.
3. POWEROTP stores the credential and identity linkage. The client website receives no WebAuthn
   material, raw PII, identity document, selfie, or Didit evidence.
4. POWEROTP redirects to the project's allowlisted sign-up return URL with a single-use,
   short-TTL opaque exchange code.
5. The client's backend exchanges the code with POWEROTP and receives the stable
   **project-scoped user ID** to save against its local account.

### Returning sign-in

1. The client website redirects the browser to its hosted sign-in URL.
2. POWEROTP authenticates the returning user with the credential registered during sign-up and
   resolves the same private identity.
3. POWEROTP redirects to the project's allowlisted sign-in return URL with a new single-use,
   short-TTL exchange code.
4. The client's backend exchanges the code and receives the same project-scoped user ID, allowing
   it to open the correct local account without possessing the user's PII or credentials.

Exchange codes are stored hashed, bound to project/transaction/user/purpose/return URL, invalidated
on first successful use, and rejected after expiry. They are not reusable browser session tokens.
Failure, cancellation, and timeout never return a success-shaped code.

## 3. Project card service controls

The existing website Project card remains the single administrator surface for all four services.
It must show and control:

- Independent enablement/status for sign-in, sign-up, BotBlocker, and Didit age/identity
  verification.
- A sign-up page-layout dropdown and a separate sign-in page-layout dropdown.
- A sign-up ad-count selector and a separate sign-in ad-count selector, each limited to 1–6.
- Separate allowlisted return URLs for sign-up and sign-in. Exact matching is required; no open
  redirects, wildcard hosts, URL fragments, or per-request arbitrary return URL.
- The generated hosted sign-up and sign-in URLs, shown when the project is created.
- Client content fields and uploaded media used by the selected layouts.

Changing credential-page settings must not alter the BotBlocker iframe settings. Enabling Didit
adds its verification step to the configured credential flow; it does not turn BotBlocker into an
identity service.

## 4. Initial hosted-page layout (basic placeholder shapes)

- **Left column, 65% width:** a vertical stack of alternating image/text blocks (block 1
  image-left/text-right, block 2 text-left/image-right, continuing to alternate). A banner ad
  placeholder (standard IAB/Google unit sizes: 300×250, 728×90, 320×50/100) sits between each
  alternating block, up to the page's configured ad count.
- **Right column, 35% width:** a centered, plain-white card hosting the selected POWEROTP
  sign-in or sign-up flow. Where configured, the flow can continue into the Didit age/identity
  step. Nav arrows on both sides of the card advance to the next card
  (security-education content, e.g. "how the QR handshake works") with a slide animation. A row
  of pagination dots below the card mirrors the cards one-to-one; the primary/default sign-in
  card's dot renders larger and green to distinguish it from the secondary educational cards.
- All text in both columns must exist in the rendered DOM, not only in canvas/image form, so it
  remains crawlable and accessible.

## 5. Client design control and crawlable content

Per-block headline, description text, and image come from client-supplied structured fields
(via project dashboard/API) rendered into a POWEROTP-owned template — never raw client-submitted
HTML/CSS/JS:

- Text fields are length-capped and HTML-escaped.
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

- **Self-serve, direct-sold only for v1** — no Google/third-party ad-network tag on this surface.
  Advertisers submit via a "this service is ad-powered by these advertisers — click here to
  advertise" flow: contact info, target genre/vertical (matched to the project's assigned
  category), creative (fixed banner sizes), destination URL, budget/duration, payment via Stripe.
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
- Every return-code exchange is authenticated with the project's server credential and audited.
