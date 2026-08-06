# Phase 0 product specification

## Accounts

The initial release has two account classes:

- `customer`: registers, signs in, owns projects, manages credentials and callbacks, and
  views only its interactions.
- `platform_admin`: identity configured privately via environment variables (not a
  self-service or database-registered account), signs in through a separate route
  restricted to an allowlisted IP address, and manages customers, telephony, recordings,
  challenges, abuse controls, and support.

Developer, viewer, and custom organization roles are outside the initial release.

## Project

A project is the isolation and integration boundary shown as one dashboard card. It owns:

- Stable URL: `/v1/projects/{projectSlug}/verifications`
- Secret API keys that are shown once, hashed at rest, rotatable, and revocable
- Enabled verification methods
- Allowed browser/application origins
- Callback URL, callback signing secret, and subscribed event types
- Rate, destination, concurrency, and spend limits
- Interaction history and aggregate counts

## Request

The customer server sends:

- `Authorization: Bearer <project-secret>`
- `Idempotency-Key: <unique-customer-value>`
- Verification `type`
- E.164 `targetNumber`
- Method options, including an optional five-digit Type 2 code
- Consent representation required by the final compliance policy

The secret API key is forbidden in URLs, browser code, mobile bundles, logs, MCP prompts,
and callback payloads.

An accepted request returns HTTP `202` with:

- `interactionId`
- `state: queued`
- `statusUrl`
- `expiresAt`
- Optional short-lived `interactionToken` for direct UI response submission

## Responses

Type 2 accepts exactly one five-digit code. Type 3 returns:

- Opaque `challengeId`
- Question text
- Between 2 and 100 opaque option IDs with labels up to 2,000 characters
- Whether multiple selections are allowed
- Minimum and maximum selections
- Expiration

Correct answers, scoring hints, internal recording paths, and predictable option IDs are
never returned. A response may be submitted by the customer server with its project key or
by a UI with a scoped short-lived interaction token.

## Events and callbacks

Events use a monotonic per-interaction sequence. The canonical states are `queued`,
`dispatching`, `calling`, `ringing`, `answered`, `playing`, `awaiting_response`,
`succeeded`, `failed`, `expired`, and `canceled`.

Every callback contains the event ID, interaction ID, type, sequence, state, occurrence
time, and optional stable reason code. Delivery uses HTTPS and a timestamped HMAC
signature. Retries are idempotent. Callback failure is visible but never changes the
underlying verification result.

## Dashboard

Each project card shows its URL, masked key information, callback status, integration
chips, activation date, per-type counts, total, succeeded, and failed counts.

Expanded rows show interaction ID, timestamp, type, state/result, masked target, duration,
verified outbound caller ID, correlation ID, and sanitized API/callback diagnostics.
Full-number reveals are audited.

## Media

- Type 2 uses reusable intro/repeat prompts and digit clips rather than 100,000 generated
  combination files.
- Type 3 uses immutable, versioned recording assets and challenge definitions.
- Admin publication validates file type, normalizes telephony audio, records duration and
  checksum, and publishes a signed manifest.
- Droplets verify checksums and atomically switch local manifests with rollback.

## Initial limits to confirm before public launch

- Supported countries and blocked prefixes
- Calls and SMS per project, IP, target number, hour, and day
- Concurrent calls and daily spend
- Call timeout, playback repetitions, interaction lifetime, and answer attempts
- Callback retry duration
- Interaction, phone-number, and audit retention
- Quiet hours, consent wording, and suppression policy

Until these are approved, production access remains allowlisted with low canary limits.
