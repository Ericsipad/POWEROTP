# Phase 0 MVP acceptance criteria

## Release-wide

- Production services refuse to start with missing or invalid required configuration.
- No fake transport, mock verification, default credential, or sample customer data can run
  in the deployed application.
- Secrets and sensitive responses are absent from source, build artifacts, logs, MCP output,
  and client bundles.
- Every external request receives a correlation ID and every verification has one durable
  interaction timeline.
- Automated type checks, unit tests, integration tests, production builds, and secret scans pass.

## Customer and admin

- A customer can register, verify email, sign in, create a project, and sign out.
- A customer can create, copy once, rotate, and revoke a project API key.
- A customer can set and verify an HTTPS callback and allowed UI origins.
- A platform admin uses a separate login route, restricted to an allowlisted IP address,
  and cannot be created through public registration; admin identity is environment
  configuration, not a database account a customer could ever be promoted into.
- Customer and admin authorization tests prove that data cannot cross customer boundaries.

## Verification API

- Duplicate requests with the same project and idempotency key produce one interaction.
- Creation returns `202`, a unique interaction ID, status URL, expiration, and optional token.
- Invalid E.164 numbers, unsupported methods, invalid transitions, expired tokens, and
  reused tokens return documented machine-readable errors.
- Callback signatures, timestamps, event IDs, and sequences verify correctly.
- Callback retry failure does not change the verification result.

## Type 1

- Answered, busy, no-answer, rejected, invalid, canceled, and timeout calls map consistently.
- An answered result is labeled reachable and never ownership-verified.

## Type 2

- Exactly five digits are accepted.
- Reusable digit recordings play in order and repeat according to policy.
- Correct response succeeds once; wrong, expired, replayed, and over-attempt responses fail.
- Codes never appear in logs, callbacks, dashboards, or stored plaintext.

## Type 3

- POWEROTP selects the immutable recording/challenge version.
- The API returns question text and opaque options without correctness information.
- Long option labels and multiple-answer rules render accessibly.
- Correct selection succeeds once; modified IDs, wrong selections, replay, and expiration fail.
- Both customer-rendered UI and the optional iframe follow the same server validation.

## Type 4

- SMS uses the shared lifecycle and provider adapter.
- Correct, wrong, expired, replayed, suppressed, and provider-failed outcomes are normalized.

## Dashboard

- Project totals reconcile with immutable events.
- Every row shows interaction ID, time, method, state/result, masked target, duration where
  applicable, caller ID, correlation ID, and sanitized callback diagnostics.
- Full-number reveals are authorized and audited.

## Telephony operations

- ARI is reachable only on localhost and customer traffic never reaches a droplet directly.
- A node enrolls with a unique mTLS identity and can be drained or revoked centrally.
- `systemd` restarts failed Asterisk/agent processes and reports unhealthy nodes centrally.
- New work routes away from a failed node; retry policy avoids uncontrolled duplicate calls.
- A second geo node can join without changing customer API configuration.

## MCP

- Cursor, Claude, and a generic MCP client can connect using the published snippet.
- MCP accurately explains all methods, schemas, statuses, callbacks, tokens, and examples.
- MCP has no path to customer data, credentials, project settings, calls, or SMS.
