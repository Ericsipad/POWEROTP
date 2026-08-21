# POWEROTP hosted-auth data governance and trust boundaries

Normative P0-S2 classification for Sign-Up and Sign-In as a Service. The executable counterpart is
`backend/packages/contracts/src/hosted-auth-data-governance.ts`. P0-S1 product and realm boundaries
remain authoritative in
[`POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md`](POWEROTP_SIGNIN_AD_SERVICE_BOUNDARIES.md).

This document assigns custody, exposure, retention behavior, and deletion execution. It does not
set P0-S3 consent/vendor wording or add the P0-S4 hosted-auth threat-model section. Counsel-approved
calendar periods remain policy inputs where noted; lack of a final duration does not permit
indefinite retention.

## Custody modes

`powerotp_pii`:

- POWEROTP is controller and contact custodian.
- Recoverable email/phone is envelope-encrypted in Supabase; dedicated keyed lookup values are
  stored separately from ciphertext and usable keys.
- POWEROTP's purpose-separated Brevo/SMS/voice adapters authenticate contact. Didit cannot silently
  replace that route because a project enables another Didit capability.

`didit_pii`:

- POWEROTP remains controller for hosted auth; Didit is the contact storage/verification custodian.
- Recoverable email/phone exists only on the persistent Didit User. POWEROTP stores dedicated keyed
  lookup values and the opaque permanent Didit mapping, never recoverable contact plaintext.
- Didit authenticates contact. Brevo/SMS/voice cannot silently replace that route.

WebAuthn calls neither contact provider. A custody-mode change requires a new project.

## Data classes

Each class has exactly one deletion executor, even when an orchestration saga calls multiple
systems:

- `person_profile_metadata` — POWEROTP/Supabase; no client exposure; account lifecycle plus the
  approved post-account period; hosted deletion orchestrator.
- `contact_plaintext` — `powerotp_pii` only, POWEROTP/Supabase under envelope encryption; no client
  exposure; account lifecycle plus approved period; hosted deletion orchestrator and crypto-shred.
- `contact_provider_record` — `didit_pii` only, Didit persistent User; no client exposure; account
  lifecycle plus approved period; Didit deletion adapter, reconciled by POWEROTP.
- `contact_keyed_lookup` — POWEROTP/Supabase for either mode; no client exposure and not anonymous;
  retained only while the identity remains serviceable; hosted deletion orchestrator.
- `webauthn_public_credential` — POWEROTP/Supabase, realm-profile scoped; no client exposure;
  credential lifecycle plus approved security period; hosted identity service.
- `provider_identity_mapping` — POWEROTP/Supabase, containing only the private opaque POWEROTP/Didit
  mapping; no client exposure; account lifecycle plus approved period; hosted deletion orchestrator.
- `consent_evidence` — POWEROTP/Supabase; no client exposure; approved audit period; hosted deletion
  orchestrator subject to required evidence holds. P0-S3 owns its exact purposes and wording.
- `verification_claim_and_minimal_evidence` — POWEROTP/Supabase; clients receive only
  project-authorized outcomes, never the evidence; approved legal/audit period; hosted deletion
  orchestrator subject to required evidence holds.
- `provider_verification_media_process_and_purge` — Didit only; no client or POWEROTP database copy;
  deleted after a durable minimal decision/evidence record is established, subject to the provider
  capability's configured hard cap; Didit deletion adapter with retry/reconciliation.
- `provider_retained_face` — Didit only and only for the separately enabled biometric-authentication
  capability; no client or POWEROTP database copy; capability-policy retention; Didit deletion
  adapter with retry/reconciliation.
- `auth_request_runtime` — dedicated runtime MongoDB; encrypted result and hashed poll token;
  authorized outcome exposure only; active lifetime followed by exactly three minutes after every
  terminal outcome, then runtime deletion.
- `redacted_auth_request_audit` — separate protected MongoDB retention boundary; no client
  exposure, poll token, browser handle, PII, provider secret, or complete result; approved
  audit/billing/support period; hosted audit service.
- `project_identity_binding` — protected MongoDB retention boundary; only its `projectUserId` leaves
  POWEROTP and only to that project; account lifecycle plus approved period; hosted deletion
  orchestrator.
- `wrapped_identity_key` — protected wrapped-key store plus KMS authority; no client exposure or
  plaintext DEK; retained only until identity crypto-shred; KMS key service.
- `key_authority_material` — KMS/HSM only, including key-encryption keys, derivation pepper, and
  keyed-lookup secrets; no client/database exposure; key rotation/destruction policy; KMS service.
- `auth_page_configuration_and_assets` — protected project configuration/content stores; the owning
  project receives only its own settings; project lifecycle plus approved period; hosted project
  service, including superseded asset deletion.
- `auth_security_event` — protected retention MongoDB; no client exposure; approved audit period;
  hosted security-audit service.
- `client_local_account_mapping` — client system; only `projectUserId`; client-selected retention
  and deletion. It gives the client no POWEROTP identity deletion or credential-reset authority.

Consent evidence is security/audit evidence governed by the approved audit period. Its exact
purposes, text, vendor disclosures, and production gates belong exclusively to P0-S3.

## Trust boundaries

1. A client backend creates an auth request with its project API key and reads a result only with
   that key plus the shown-once, request-bound poll token. Neither secret enters browser code.
2. The browser operates only inside the selected top-level realm with a host-only request cookie
   and same-origin CSRF value. Browser redirects and completion hints are never authoritative.
3. Project ownership, request, flow, realm, binding, and return URL are resolved server-side.
   Caller-supplied IDs never grant cross-project access.
4. Realm credentials, user handles, cookies, and ceremonies do not cross `authx`/`authz`.
5. Supabase, runtime MongoDB, retention MongoDB, and KMS are separate least-privilege boundaries.
   A database-only compromise cannot decrypt recoverable PII. Runtime compromise is not assumed
   harmless and must be bounded by service roles, KMS grants, network rules, and audit.
6. Provider operations use mode/purpose-specific adapters. Signed callbacks are timestamp checked,
   replay protected, ordered, and reconciled before changing authoritative state.
7. Support/admin access is audited and cannot directly authorize recovery, replace a credential, or
   disclose PII/evidence to a client. Recovery requires the defined end-user proof path.
8. Deletion is a saga: mark the identity deleting, block new authentication, purge hot data,
   revoke credentials, request provider deletion, preserve only required redacted evidence,
   crypto-shred the identity DEK, and reconcile every incomplete external deletion.

## Abuse cases and required ownership

- Cross-project lookup or binding replay — API/project authorization and poll-token scope deny it;
  hosted API owner.
- Open redirect or return-URL substitution — exact server-stored URLs only; project-config/API
  owner.
- Cross-realm credential/cookie replay — exact origin/RP/realm validation; hosted identity owner.
- Compromised client requests global recovery/reset — initiation carries no recovery authority;
  hosted recovery owner.
- Contact enumeration, OTP pumping, and recovery brute force — generic responses plus layered
  project/IP/request/identity/destination/channel limits; hosted auth and provider-adapter owners.
- Poll-token theft/replay — high entropy, hashed storage, API-key pairing, constant-time comparison,
  three-minute terminal window, and audit; runtime owner.
- Provider callback forgery/replay/order abuse — signature, timestamp, nonce/event ordering, and
  reconciliation; provider-adapter owner.
- Database dump or ciphertext swapping — envelope encryption, field-bound AEAD associated data,
  wrapped DEKs, separate KMS grants, and keyed lookup secrets; identity/KMS owners.
- Runtime-service compromise — minimal hot schema, no usable key material at rest, narrowly scoped
  service roles, short result retention, and privileged-operation audit; runtime/platform owners.
- Support impersonation or privileged deletion/credential mutation — no support-only proof,
  separation of duties, immutable event logging, and user-visible recovery controls; support and
  security owners.
- Logging/analytics leakage — redact PII, contact values, keys, tokens, cookies, credential IDs,
  provider secrets, and evidence; every service owner, enforced by platform logging policy.
- Deletion failure or provider orphan — durable deletion state, idempotent retries, reconciliation,
  and operator alerting; hosted deletion orchestrator owner.

These hosted-auth abuse cases do not modify BotBlocker behavior, plans, data, or ownership.
