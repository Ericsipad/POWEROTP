# POWEROTP hosted-auth glossary and product boundaries

Normative P0-S1 terminology for the hosted Sign-Up and Sign-In as a Service product. The
machine-readable counterpart is
`backend/packages/contracts/src/hosted-auth-boundaries.ts`.

## Glossary

- **Hosted auth**: the POWEROTP-owned top-level sign-up and sign-in ceremonies for a client
  project. It is the product named `powerotp_hosted_auth` in the executable boundary contract.
- **Private person root**: POWEROTP's internal record for one person. It is never a client subject
  identifier and is never returned to a client.
- **Authentication profile**: the realm-specific credential identity below a private person root.
  A person root can have at most one `powerotp_pii` profile and at most one `didit_pii` profile.
- **Identity data mode**: the immutable project choice that selects contact custody and the
  authentication realm: `powerotp_pii` or `didit_pii`.
- **Realm**: one exact HTTPS origin and WebAuthn RP ID. Realm boundaries contain passkeys, user
  handles, and cookies.
- **Project user ID**: the stable pairwise identifier exposed to one client project. It is not the
  person-root ID or authentication-profile ID and cannot be used to correlate projects.
- **Fresh proof**: a new authentication ceremony for the current client auth request. A remembered
  account, another client's session, or a previous POWEROTP ceremony cannot satisfy it.
- **Client session**: a session created, refreshed, expired, and revoked by the client after it
  receives an authoritative successful poll result. POWEROTP does not issue it.

## Exact realm mapping

| Identity data mode | Top-level origin | WebAuthn RP ID |
| --- | --- | --- |
| `powerotp_pii` | `https://authx.powerotp.com` | `authx.powerotp.com` |
| `didit_pii` | `https://authz.powerotp.com` | `authz.powerotp.com` |

The mapping is exact. A request, cookie, user handle, passkey, registration, or assertion from one
realm is not valid in the other. One private person root may own both profiles, but profile
credential material is never shared or copied between them.

## Product boundaries

Hosted auth contains only the hosted `signup` and `signin` services. Optional Didit assurance may
be a step in those ceremonies without changing the product boundary.

- **BotBlocker is separate.** Its customer-site gate, OTP iframe, decisions, sessions, Passport
  assertions, and plans are not hosted-auth contracts. Hosted-auth work must not modify BotBlocker
  behavior or treat a BotBlocker result as hosted-auth proof.
- **Human Passport is separate.** Hosted auth does not issue, accept, or silently merge a Passport
  identity in this scope. A future nullable link may be designed separately; its absence or presence
  cannot collapse the two products or expose either internal identity.
- **Dashboard customer authentication is separate.** A POWEROTP customer/admin dashboard session
  does not authenticate a hosted end-user request.
- **No cross-client SSO exists.** Every client auth request requires fresh proof. UI-only cookies
  may improve account discovery but carry no authentication authority.
- **Client exposure is pairwise and minimal.** A successful client result identifies the person
  only as `projectUserId`. Clients never receive person-root/profile IDs, PII, encrypted PII,
  decryption keys, WebAuthn material, Didit evidence, or another project's binding.

## Contract ownership

P0-S1 locks names and relationships only. Later steps own identifier formats, persistence schemas,
request state machines, provider interfaces, and browser/API payloads. Those contracts must import
or preserve these exact boundaries rather than redefining them.

P0-S2 data custody and governance are locked separately in
[`POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md`](POWEROTP_SIGNIN_AD_SERVICE_DATA_GOVERNANCE.md);
they preserve every boundary above.
