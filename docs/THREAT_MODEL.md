# Phase 0 threat model

## Protected assets

- Customer, admin, project, callback, provider, SIP, Spaces, and node credentials
- Phone numbers, interaction history, recordings, challenges, and correct answers
- Verification integrity, event ordering, callback authenticity, and usage balances
- Telephony availability and the ability to place paid calls or SMS

## Trust boundaries

1. Customer server to public API
2. Customer UI or hosted iframe to public API
3. App Platform services to Atlas, Valkey, and Spaces
4. Telephony agent to the central node API over mTLS
5. Telephony agent to localhost-only Asterisk ARI
6. Asterisk to VoIP.ms SIP trunks
7. POWEROTP API background processor to customer-controlled HTTPS endpoints
8. Public AI clients to the anonymous read-only MCP server

## Required controls

### Credential theft

- Hash project API keys; display them once and support rotation/revocation.
- Encrypt provider credentials with a master key held in App Platform.
- Use unique node certificates, short-lived enrollment tokens, and central revocation.
- Redact authorization, cookies, codes, tokens, SIP secrets, and answers from logs.
- Require MFA and shorter sessions for platform admins.

### Unauthorized or abusive calling

- Apply project, IP, number, prefix, country, concurrency, and spend limits before queuing.
- Require an explicit consent representation and maintain suppression/deny lists.
- Permit only provider-verified outbound caller IDs.
- Add per-project and global emergency kill switches.
- Alert on unusual answer rates, destination concentration, costs, and repeated failures.

### Enumeration and privacy

- Use opaque sortable interaction IDs with sufficient entropy.
- Return stable but non-enumerating errors.
- Mask phone numbers by default and audit full-number reveals.
- Define data retention and delete or redact sensitive data on schedule.

### Replay and race conditions

- Require idempotency keys for creation.
- Bind interaction tokens to one project, interaction, action, origin, nonce, and expiry.
- Consume response tokens after accepted submission or terminal state.
- Guard every transition atomically and reject invalid or stale sequences.
- Sign callbacks with timestamp and event ID; require replay windows and idempotent handling.

### Challenge disclosure or manipulation

- Keep correct answers server-side.
- Use random option IDs scoped to one interaction and randomize option order.
- Do not expose internal recording IDs or paths.
- Cap attempts and expire/consume challenges.
- Test bundles, API payloads, source maps, logs, and MCP output for answer leakage.

### Browser and iframe attacks

- Never put project API keys in a browser or mobile bundle.
- Bind interaction tokens to allowed origins/applications.
- Validate both sides of `postMessage`.
- Send response-specific CSP `frame-ancestors`; apply CSRF and secure cookie controls.

### Callback SSRF

- Require HTTPS.
- Reject loopback, private, link-local, multicast, and cloud metadata destinations.
- Resolve and verify DNS at delivery time and after redirects; disable unsafe redirects.
- Enforce response-size, connection, and total-time limits.

### Node compromise

- Expose no ARI, AMI, MongoDB, Valkey, or customer API ports publicly.
- Use host firewall, key-only SSH, non-root agent, localhost ARI, `systemd` hardening,
  unattended security updates, and least-privilege Spaces access.
- Give a node only its assigned trunks/configuration and support immediate certificate drain
  and revocation.

### Availability and duplicate calls

- Lease work with renewal and expiry; stop assignment when heartbeats fail.
- Never assume an active call can migrate between nodes.
- Retry only where state evidence and policy make duplicate calling acceptably unlikely.
- Reconstruct queues from durable MongoDB events after Valkey loss.
- Keep local media manifests versioned and retain the previous version.

### MCP abuse

- MCP is anonymous, read-only, rate-limited, and separately deployable.
- It has no database customer access, credentials, project tools, or call/SMS execution.
- Generate its content from versioned contracts and documentation.

## Compliance gates

Before unrestricted production traffic, obtain an appropriate legal review covering
consent, TCPA/telemarketing restrictions, do-not-call handling, quiet hours, STIR/SHAKEN,
caller-ID rules, recording disclosure, privacy notices, retention, deletion, supported
countries, and provider acceptable-use requirements.

This document is an engineering threat model, not legal advice.
