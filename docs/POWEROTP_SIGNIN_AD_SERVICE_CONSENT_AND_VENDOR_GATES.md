# POWEROTP hosted-auth consent, vendor, and claims policy

Normative P0-S3 policy for Sign-Up and Sign-In as a Service. The executable counterpart is
`backend/packages/contracts/src/hosted-auth-consent-and-vendor-gates.ts`. P0-S1 product boundaries
and P0-S2 custody rules remain authoritative.

Final legal copy, calendar retention periods, minor handling, controller language, and
international-transfer language remain counsel-approved inputs. No Didit capability may enter
production merely because its adapter or credentials are available.

## Consent purposes

Each purpose is separately named, versioned, and recorded. Consent cannot be bundled across
capabilities, preselected, inferred from continued use, or collected after provider collection has
begun.

- `hosted_identity_and_authentication` — the reusable POWEROTP hosted identity and fresh
  authentication service, including cross-project reuse of the private identity while exposing only
  a distinct project user ID to each client.
- `didit_contact_custody_and_authentication` — `didit_pii` only; Didit's persistent User stores and
  verifies contact for hosted authentication.
- `age_assurance` — an optional Didit-backed age requirement decision. A still-valid minimal
  identity claim may be reused across projects under this disclosed purpose.
- `identity_kyc_assurance` — optional Didit-backed identity/KYC assurance. A still-valid minimal
  identity claim may be reused across projects under this disclosed purpose.
- `liveness_and_face_enrollment` — optional liveness and face processing for the current configured
  assurance operation; it does not authorize a retained face.
- `fresh_biometric_authentication_with_retained_face` — optional biometric authentication that
  intentionally retains the approved face on the persistent Didit User and requires its own
  affirmative decision and retention disclosure.

Every record contains the exact text version, policy version, purpose, named provider disclosure,
locale, timestamp, affirmative action, and withdrawal/deletion path. Didit is named before its
collection begins and before biometric capture. A past biometric-authentication event is not current
user presence; every biometric authentication is a fresh provider ceremony.

## Didit production gates

All applicable gates must be evidenced before any Didit-backed hosted-auth capability is enabled in
production:

1. Counsel-approved POWEROTP controller notice and capability-specific consent.
2. Didit named before provider collection or biometric capture.
3. Written contractual carve-out permitting the intended reusable hosted-identity and assurance
   model without violating competing-service restrictions.
4. Approved data-processing and subprocessor terms.
5. Capability-specific provider retention configured with no indefinite default; process-and-purge
   and retained-face policies remain distinct.
6. Written model-training opt-out.
7. Provider deletion, retry, and reconciliation behavior validated.
8. Approved vendor-exit and replacement plan. Public/client contracts remain vendor-neutral and no
   Didit SDK type may appear in them.

These are production activation gates, not claims that the legal or commercial work is already
complete. Provider API keys or workflow IDs do not satisfy them.

## Certification wording

The only approved pre-certification wording is:

- “designed to align with ISO/IEC 27001 controls”
- “uses infrastructure providers whose applicable services are certified”

The second statement must identify only certifications actually applicable to the named provider
service. A provider certificate is evidence about that provider's applicable service, never a
POWEROTP certification.

## Prohibited claims

Until POWEROTP completes the applicable contracts, controls, evidence, and independent assessment,
hosted-auth marketing, sales, support, UI, API, and security-questionnaire responses must not claim:

- that POWEROTP is ISO 27001 certified, SOC 2 compliant, or HIPAA compliant;
- that a vendor's certification covers or certifies POWEROTP;
- that hosted authentication, identity verification, or age assurance is guaranteed;
- that project-scoped identifiers, keyed lookups, or pseudonymous records are anonymous;
- that clients have no privacy or compliance obligations for the identifiers and outcomes they
  receive;
- that biometrics are never retained when retained-face biometric authentication is enabled;
- that Didit can be omitted from the provider disclosure; or
- that one consent authorizes undisclosed future capabilities or purpose changes.

Claims must also preserve the P0-S1/P0-S2 boundaries: no client receives PII, a global identity,
provider evidence, or credential material, and no claim may imply Passport or BotBlocker is the
hosted-auth product.
