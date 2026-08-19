# BotBlocker Phase 17A — Unified risk report and reducer design

**Status: implementation in progress; canonical contract/transport and risk-event
configuration/row-scoring slices complete (2026-08-19).**
This document is the field-by-field authority for Phase 17A implementation-split item 7.
It supersedes the earlier assumption that initial requests, behavior reports, and risk-signal
batches should remain separate scoring inputs.

Ground truth for shipped behavior remains
[`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md). Nothing here is as-built
evidence.

## Approved simple model

The customer middleware sends one canonical risk report containing whatever approved data it has
at that moment. The same shape is used to start a session and for every later update. Report
timing does not create different persistence or scoring models.

1. POWEROTP validates and stores one immutable `riskEvents` row.
2. The current admin-configured risk-event functions score the fields present on that row.
3. The insert-time row score is stored on that row.
4. The score is incorporated into the linked `userIntelligence.risk_events_sum` arithmetic
   average.
5. `risk_events_sum` is one numeric field in the existing user-intelligence admin scoring
   registry. Its admin-configured function and weight contribute to `currentScore`.
6. After the transaction commits, the existing score compare-and-set and data-ready callback
   sequence runs unchanged.

No raw report field is copied onto `userIntelligence` merely to make it scoreable.

## One report contract and route

Replace the separate initial RapidAuth, browser-assessment, and risk-event report inputs with:

`POST /v1/botblocker/reports/{webhookId}`

Every report requires only the closed routing, authorization-binding, freshness, replay, and
ordering envelope:

- protocol version;
- project-bound `siteId`;
- opaque `gateSessionId`;
- authenticated audience;
- monotonic report sequence;
- nonce;
- issued time.

The body may contain any available approved fields:

- trusted request context;
- sanitized browser behavior evidence;
- the bounded browser fingerprint vector;
- candidate clearance, Passport, or paid-pass proofs;
- bounded risk signals;
- server-derived blacklist/network evidence added during ingestion.

Every evidence field is optional. Missing data is omitted, never fabricated or zero-filled.
Credentials are not report fields: the first report uses the server-only site credential; after
that report commits, POWEROTP returns the 30-minute project/site/session/audience-bound visitor
token and the middleware uses that token for later reports.

The middleware normally includes the fingerprint only while it has no visitor token. Receipt of
the token proves the first report created or resolved the durable session/profile boundary, so
later reports omit the fingerprint. A later report cannot replace fingerprint data through the
unified report reducer; the existing accepted-session fingerprint ordering remains authoritative.

The reusable site credential and visitor token remain absent from the immutable row, browser
JavaScript, callbacks, and browser-visible state. Cookie and Passport material remains proof or
server-held binding data, never a caller-authored identity.

## One immutable `riskEvents` row

Each accepted report creates exactly one row. The row contains:

- customer/project/site, gate-session, and `userIntelligence` binding;
- report sequence and immutable event ID;
- the complete validated canonical report;
- server observation and retention timestamps;
- the insert-time `risk_event_score`.

There is no scoring distinction between a first report, a five-second report, a 30-second report,
or a partial report. Those facts may remain bounded metadata for diagnostics, but the scorer
evaluates only the fields present.

Exact replay returns the existing row without applying the average twice. Equal-sequence changed
input, stale sequence, cross-scope input, failed authentication, and failed transactions create
no row and no profile update. `riskEvents` remains retained for 90 days; the profile remains
retained for 548 days.

## Risk-event scoring configuration

Risk-event scoring is a separate operator configuration from the existing user-intelligence
profile scoring configuration. It reuses the same safe design:

- one closed registry row per approved field;
- `enabled` toggle;
- restricted bounded expression;
- nonnegative weight;
- one restricted final expression over weighted sum, present weight sum, and present-field count;
- no JavaScript, `eval`, dynamic property access, database access, filesystem access, or network
  access;
- no seeded formula, weight, coefficient, threshold, range, or default score.

Numeric expressions may map a value or numeric range to a result. String, enum, and boolean inputs
may use exact comparisons to map a word/value to a number. Missing, disabled, non-finite, or
incompatible fields are excluded from both the aggregate and denominator.

Unconfigured scoring, no enabled usable fields, division by zero, and an invalid final result
produce a typed unavailable row score. An unavailable row score is stored for audit but is not
included in `risk_events_sum`.

Configuration changes apply only to reports accepted afterward. Existing immutable row scores
and the profile average are not recalculated, reset, or backfilled. No scoring-configuration
version is stored on a row or profile.

## V1 field map

All registry fields start absent/disabled until an operator explicitly supplies configuration.
The first implementation exposes only fields with direct, unambiguous reduction semantics.

### V1 numeric fields

- total click count;
- one count for each fixed click category;
- mouse directness ratio when `sampleCount > 0`;
- mouse directness sample count;
- scroll smoothness score;
- high-speed scroll event count;
- honeypot activation count;
- page total duration;
- page active duration;
- document width and height;
- occupied pointer-bin count;
- total pointer sample count across bins;
- total bounded pointer dwell time across bins;
- one `0 | 1` presence value for each fixed automation indicator;
- one count for each fixed risk-signal kind.

Sums and counts use safe integer arithmetic. Overflow or a non-finite result makes only that field
unavailable. Mouse directness with zero samples is unavailable rather than treated as zero.
Pointer totals are derived from the already bounded sparse 32×32 bins; no raw trail is created.

### V1 exact categorical fields

- trusted HTTP method;
- fixed automation-indicator values when configured through exact matching;
- fixed risk-signal kinds when configured through exact matching.

The numeric count/presence forms above are preferred where they express the same information more
simply.

### Retained on `riskEvents`, not scoreable in V1

- route path and server-derived page URL;
- explicit page ID/name;
- explicit click IDs and normalized click positions;
- individual pointer-bin coordinates;
- navigation target;
- individual honeypot IDs;
- full fingerprint components;
- arbitrary proof identifiers, nonces, and expiry values;
- sensor/report timing labels;
- external IP-vendor payloads.

These fields remain available for project-scoped analytics, auditing, or a later explicitly
approved registry extension. They are not copied to the hot profile. Full URLs with query or
fragment, clicked text, form values, DOM/page content, raw coordinates/trails, raw keystrokes,
passwords, and emails remain prohibited.

### Existing profile-owned inputs

Selected fingerprint fields, current/prior IP evidence, exact-IP reuse counts, and the verify
lookup continue through the already-shipped gate-session synchronizer. They are not reimplemented
by this reducer. Duplicate evidence is not an identity path and never changes profile-selection
precedence.

## Row score and profile average

Each immutable row stores:

- `risk_event_score.status`;
- an available finite `0..100` score, or a typed unavailable reason.

The linked profile stores:

- `risk_events_sum`: the arithmetic average of all available insert-time risk-event row scores
  accepted for that profile, despite the approved field name ending in `_sum`;
- a backend-only scored-row count required to update that average safely.

The count is bookkeeping, not an admin scoreable field. The average update is atomic with the
row insert and sequence advance. Concurrent reports linked to one profile cannot lose an accepted
score. A failed row score/profile update rolls back the sequence, row, and average together.

`risk_events_sum` is added as a numeric row in the existing user-intelligence admin scoring
registry. An admin can enable or disable it and assign its restricted function and nonnegative
weight. It then participates in the existing final profile aggregate that replaces
`userIntelligence.currentScore`. No hardcoded relationship exists between the event average and
the overall profile score.

The stored per-event score is an observation result, not `currentScore` history. The profile still
stores only one replaceable overall `currentScore`.

## Transaction and callback order

For one accepted report:

1. validate endpoint, scope, credential/token, audience, freshness, nonce, and sequence;
2. open or resolve the exact gate session and profile;
3. derive server-owned evidence;
4. evaluate the report fields under the current risk-event scoring configuration;
5. insert the immutable row and atomically update `risk_events_sum` in one MongoDB transaction;
6. issue/persist safe visitor-token metadata when this is the first report;
7. commit;
8. recalculate overall `currentScore` from the committed profile under its existing
   `updatedAt` compare-and-set;
9. enqueue the bounded data-ready callback only when that replacement succeeds.

Replay, rejection, rollback, unavailable row scoring, and a lost profile-score compare-and-set do
not fabricate a score or enqueue an update based on uncommitted state.

## Implementation split

Execute in separate fresh implementation sessions:

1. **Status: complete (2026-08-19). Canonical contract and transport.** Added the unified report
   contract/route, updated the shared Node authority plus inherited Express/Next and MCP templates,
   and removed the superseded report routes/contracts/branches.
2. **Status: complete (2026-08-19). Risk-event configuration and row scoring.** Added the closed
   V1 registry, operator configuration route/admin row, restricted evaluation, immutable
   insert-time row score, and field-level/transaction/replay tests. No configuration is seeded.
3. **Profile average and overall scoring integration.** Add `risk_events_sum`, atomic
   average/count update, the user-intelligence admin registry row, post-commit score/callback
   integration, concurrency/rollback tests, and update the as-built record.

Every touched workspace must run build, full lint/typecheck, and tests once. Because contract and
transport consolidation crosses workspaces, run the affected contracts, API, backend, gate-core,
gate-node, inherited wrapper/MCP suites, and the gate-next production bundle test if browser code
changes. A final full `npm run verify` is warranted before push. Do not commit or push without
explicit authorization.

## Explicit exclusions

- No Phase 18 customer sensitivity or OTP policy.
- No external IP-vendor profile fields.
- No site-return cookie, Passport implementation, or visitor-token refresh.
- No OTP orchestration, billing, edge publication, or global verify Worker.
- No hardcoded scoring configuration, fake data, migration, seed, deployment, or traffic
  activation.
