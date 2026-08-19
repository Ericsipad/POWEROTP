# BotBlocker Phase 17A — Fingerprint collection and gate-session profile sync plan

**Status: implementation in progress; unified report transport and risk-event
configuration/row scoring complete (2026-08-19).** This document is the durable result of the
Phase 17A design session. Despite the historical filename, this phase does not design the
separate `riskEvents` behavior reducer. It defines:

1. comprehensive browser fingerprint collection;
2. the shared `fingerprintData` collection;
3. the fixed gate-session-to-`userIntelligence` synchronization;
4. current and recent exact-IP profile evidence; and
5. the atomic/idempotent boundary that later implementation must follow.

The separate `riskEvents` → `userIntelligence` design is now approved in
[`POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md).
It replaces the historical multi-record assumption with one canonical middleware report, one
immutable row score, and the `userIntelligence.risk_events_sum` average. Runtime implementation
remains split into later fresh sessions.

Ground truth for shipped behavior remains
[`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md). The approved parent design
is [`POWEROTP_BOTBLOCKER_PHASE17_PROPRIETARY_SCORING_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17_PROPRIETARY_SCORING_PLAN.md).
Nothing in this document is as-built evidence.

## Corrections established in this design session

1. **Collection precedes complete profile reduction.** Session and fingerprint inputs may be
   collected and stored before every possible `userIntelligence` updater exists. Scoring,
   callbacks, and other functions must continue using present fields; one missing field never
   breaks the whole process.
2. **There are two distinct profile update paths.**
   - This plan defines fixed synchronization from accepted gate-session data.
   - The approved unified risk-report plan defines insert-time row scoring and the profile average.
3. **Gate-session synchronization is not operator-authored math.** Source and target fields keep
   the same names. The update operation is fixed by field semantics: latest successful
   replacement, bounded exact-value history, or rolling exact-IP count.
4. **Profile-to-score math remains separate operator configuration.** Operators may later enable
   the approved profile fields and configure their score formulas. That does not change how raw
   session data is collected or synchronized.
5. **The full browser vector does not belong on the hot profile row.** It lives in a shared,
   platform-level MongoDB collection named `fingerprintData`, not in a collection prefixed with
   one product feature.
6. **FingerprintJS supplies no IP or IP-reputation data.** IP is trusted server request context.
   ASN classification and external reputation are independent server-side sources.
7. **Raw persistence precedes the only fingerprint-derived hash.** No inbound fingerprint or IP
   value is hashed. The first request is saved to the session, an initial immutable risk event,
   `fingerprintData`, and the linked `userIntelligence` profile. During that profile's
   create/update, the approved stable-source fields are written to the row and converted into the
   versioned verify lookup hash stored on the same row.
8. **Session and user identity are separate.** The 30-minute visitor token authorizes writes for
   one session. At minute 29 the middleware requests refresh and replaces the bearer in its own
   server-side gate session without changing that session ID. The signed persistent site-return
   cookie binds the browser to one `userIntelligence` row across sessions; a valid cookie grants
   immediate local access while continued reports may revoke access or require OTP.

## Actual current session storage

The current implementation physically splits one logical session dataset:

- `gateSessions` is the small mutable session header. It currently stores profile linkage,
  fingerprint hash, trusted normalized IP, optional network classification, optional external
  IP-reputation snapshot, latest decision, sequence, and timestamps.
- `riskEvents` stores immutable accepted `behavior_report` and `risk_signal` rows linked by
  `gateSessionId` and `userIntelligenceId`.
- `userIntelligence` is the long-lived aggregate profile.

The current pre-persistence fingerprint hash and omission of the initial risk-event row are
implementation gaps, not the target design. First contact must create the gate-session header and
write the complete initial middleware request as the first immutable `riskEvents` row, including
its available IP, browser/fingerprint, request, proof, and risk evidence. The five-second,
recurring 30-second, and partial navigation/hide/exit reports append immutable detail while
advancing the linked gate session's accepted sequence and timestamps. This physical split remains
because it preserves bounded MongoDB documents and indexed ordering/idempotency.

The approved Phase 17 retention correction remains:

- `gateSessions` and linked `riskEvents`: 90 days;
- `fingerprintData` and `userIntelligence`: 548 days/18 months.

## Browser collector

Use exactly `@fingerprintjs/fingerprintjs` v5.2.0 initially, pinned rather than ranged. It is a
component collector only:

- initialize with `monitoring: false`, preventing FingerprintJS usage-statistics requests;
- run the expensive collection once per newly created gate session;
- map component output into POWEROTP-owned closed, bounded, versioned contracts;
- discard FingerprintJS `visitorId`;
- discard FingerprintJS confidence score/comment;
- do not persist component timing as profile evidence;
- map collector errors to a small typed availability enum and never retain arbitrary raw error
  objects;
- never accept the library visitor ID or a browser-supplied hash as identity authority.

### Exact FingerprintJS v5.2.0 component inventory

The full available component vector stored in `fingerprintData` consists of:

1. `userAgentData`: `brands`, `mobile`, `platform`, optional `architecture`, `bitness`, `model`,
   `platformVersion`, and `highEntropyStatus`.
2. `fonts`: bounded detected-font names from the collector's fixed list.
3. `domBlockers`: bounded detected blocker-list names.
4. `fontPreferences`: numeric `default`, `apple`, `serif`, `sans`, `mono`, `min`, and `system`
   measurements.
5. `audio`: finite AudioContext fingerprint value or mapped typed status.
6. `screenFrame`: top/right/bottom/left frame measurements.
7. `canvas`: `winding`, `geometry`, and `text`.
8. `osCpu`.
9. `languages`.
10. `colorDepth`.
11. `deviceMemory`.
12. `screenResolution`: width and height.
13. `hardwareConcurrency`.
14. `timezone`.
15. `sessionStorage`.
16. `localStorage`.
17. `indexedDB`.
18. `openDatabase`.
19. `cpuClass`.
20. `platform`.
21. `plugins`: bounded name, description, and MIME type/suffix values.
22. `touchSupport`: `maxTouchPoints`, `touchEvent`, and `touchStart`.
23. `vendor`.
24. `vendorFlavors`.
25. `cookiesEnabled`.
26. `colorGamut`.
27. `invertedColors`.
28. `forcedColors`.
29. `monochrome`.
30. `contrast`.
31. `reducedMotion`.
32. `reducedTransparency`.
33. `hdr`.
34. `math`: the collector's fixed standardized math-operation result map.
35. `pdfViewerEnabled`.
36. `architecture`.
37. `applePay`.
38. `privateClickMeasurement`.
39. `audioBaseLatency`.
40. `dateTimeLocale`.
41. `webGlBasics`: version, vendor, unmasked vendor, renderer, unmasked renderer, and shading
    language version.
42. `webGlExtensions`: context attributes, parameters, shader precisions, extensions, extension
    parameters, and unsupported extensions.

Missing component data may be omitted without failing collection. When the collector explicitly
reports unavailable, blocked, skipped, unstable, unsupported, or bounded collector-error state,
that state remains typed in the `fingerprintData` vector. Values are never fabricated.

## `fingerprintData` persistence

`fingerprintData` is shared platform data that may support multiple products. It is not named
`botblockerFingerprints`.

Maintain one current record per `userIntelligence` row. The simplest one-to-one relationship is
an `_id` equal to the linked `userIntelligenceId`; implementation may instead use an opaque ID
only if it preserves one-record-per-profile uniqueness.

The record contains:

- full customer/project/site scope required by the current profile boundary;
- linked `userIntelligenceId`;
- `fingerprintVersion`;
- pinned `collectorVersion`;
- `hashRecipeVersion`;
- the complete bounded component vector above;
- current server-derived `stableFingerprintHash` when derivation is available;
- the gate session and server observation time that supplied the current vector;
- `firstObservedAt`, `lastObservedAt`, `createdAt`, `updatedAt`, and
  `retentionExpiresAt`.

It stores only the current full vector, not one high-volume record every five or 30 seconds.
Collection occurs once per new gate session; a newer accepted session replaces the current
vector. The previous vector is not retained as a hash alias or historical fingerprint row.

### User-row verify lookup subset

This is the previously approved verify lookup recipe. It is not an inbound fingerprint hash and
is not used before raw persistence. During `userIntelligence` creation/update, write this
comparatively stable source subset to the row, then canonicalize and HMAC those row values:

- platform family;
- CPU architecture and bitness;
- mobile model when available;
- hardware concurrency;
- coarsened device memory;
- maximum touch points;
- stable device-class display properties, excluding frequently changing window/frame geometry;
- WebGL vendor/renderer, bounded capability signature, and deterministic render digest;
- deterministic canvas digest;
- deterministic AudioContext digest;
- deterministic font and font-preference digests; and
- browser vendor/family without the full changing version.

Exclude IP, behavior, full browser/OS versions, timezone, language order, exact window/frame
geometry, privacy preferences, storage state, and changing API availability from the HMAC.
Those values may remain in the full bounded vector.

The server alone canonicalizes and derives the HMAC under
`BOTBLOCKER_INTELLIGENCE_HASH_SECRET`, then stores the resulting versioned verify lookup field on
that same `userIntelligence` row in the profile persistence operation. The value comes from the
row, not directly from the inbound request or `fingerprintData`. Verify servers may use that
published field as their primary edge lookup. The home API fallback selects a profile through the
signed user-intelligence-bound site-return cookie, an authoritative Passport, or exact
raw-fingerprint comparison. IP alone never selects or merges profiles. When a later accepted
profile update produces a different derivable verify hash, replace the current field and retain
no aliases.

## Fingerprint fields synchronized to `userIntelligence`

Only the following selected FingerprintJS values are exposed as hot operator scoring fields on
the `userIntelligence` row:

1. `osCpu`;
2. `screenResolution` (`width` and `height`);
3. `platform`;
4. `touchSupport` (`maxTouchPoints`, `touchEvent`, and `touchStart`);
5. `vendor`;
6. `architecture`; and
7. `applePay`.

Names remain the same between `fingerprintData` and `userIntelligence`. These are direct latest
successful values, not averages. Averaging categorical/capacity values could create a value that
was never observed (for example, an average of four and eight CPU cores).

Separately, `userIntelligence` retains the bounded internal stable-source fields listed in the
verify recipe so creation/update can derive the lookup hash from that row. Those internal source
fields are not additional operator scoring fields and do not move the complete fingerprint vector
onto the hot row.

If a newly collected component is unavailable, synchronization performs no update for that
selected field. The last successfully synchronized profile value remains available. The complete
new `fingerprintData` vector still records the component's typed unavailable state.

These fields are possible later scoring inputs, not proof that a visitor is human or automated
and not a separate confidence model. The operator scoring registry decides whether and how each
field contributes.

## Current IP and bounded prior-IP history

Add one current-IP structure to `userIntelligence`:

```text
currentIp:
  ip
  asnScore
  blacklisted
```

- `ip` is the normalized exact trusted request IP.
- `asnScore` is the current session's configured ASN-type score and uses latest replacement.
- `blacklisted` is the observation-time result of the dedicated exact-IP blacklist lookup.
  Store this explicit boolean; do not infer it from `latestDecision`, because later decision
  sources can also produce `otp`.

Add `recentIpHistory`, a unique least-recently-used list of at most 20 prior IP entries:

```text
recentIpHistory[]:
  ip
  asnScore
  blacklisted
```

Update semantics:

1. No current IP yet: set `currentIp`; history remains empty.
2. Incoming IP equals `currentIp.ip`: update the current ASN score and blacklist boolean; do not
   append history.
3. Incoming IP differs:
   - remove the incoming IP from history if it was previously present;
   - remove the outgoing current IP's older history occurrence, if any;
   - add the outgoing current entry as the newest prior entry;
   - set the incoming entry as `currentIp`;
   - trim the least-recent prior entries beyond 20.

No per-entry timestamp or reuse count is stored. Profile-level timestamps already record the
current update, and list order records bounded recency.

This evidence may later detect rapid proxy-IP switching, but Phase 17A does not automatically
classify, flag, or blacklist an IP.

### Rolling exact-IP reuse counts

Maintain two independent sets of current exact-IP counts on `userIntelligence`:

- distinct profile counts across all websites for 1, 7, and 30 days;
- distinct profile counts on the same website for 1, 7, and 30 days.

Calculate these from trusted, retained session/profile relationships using the exact normalized
IP and time window. Count distinct profiles, not raw reports or repeated sessions from the same
profile. IPv4 and IPv6 remain separate exact values and storage paths; address family alone is
not risk.

## Score-time use of IP history

The current IP and prior-IP history remain stored evidence on `userIntelligence`. The scoring
evaluator may expose transient numeric inputs without persisting redundant derived fields:

- current ASN score;
- number of distinct prior IPs (`recentIpHistory.length`);
- average prior-IP ASN score:
  `sum(available recentIpHistory[].asnScore) / number of available prior ASN scores`;
- operator-configured aggregation of the stored `blacklisted` booleans; and
- the six global/same-site 1/7/30-day reuse counts.

The current IP is excluded from the prior-IP average. When history is empty, prior-IP count is
the real value `0`, while prior-IP ASN average and blacklist ratio-style calculations are
unavailable and omitted to prevent division by zero. If history exists but none of its entries
has an ASN score, the prior-IP ASN average is likewise unavailable and omitted. No hardcoded
score contribution, formula, weight, or threshold is supplied by this plan.

## External IP-reputation data

FingerprintJS does not supply external IP data. The Phase 16 server path owns it:

1. trusted request IP comes from customer middleware;
2. POWEROTP resolves network range/ASN locally;
3. ASN-type configuration determines whether an external lookup is required;
4. `BotBlockerIpReputationService` checks `botblockerIpApiLookupsV4` or `V6`;
5. only a configured real vendor may supply the external result.

No real external vendor client is currently active; `ip-reputation-client.ts#lookup` remains
typed unavailable. The current gate-session snapshot contains only bounded `vendor` and `score`
when available, while the vendor cache owns its raw response.

External IP data is deliberately **not** synchronized to `userIntelligence` in the first
gate-session updater. A later dedicated session will:

- inventory the real selected vendor's bounded contract;
- approve which external IP fields append to `userIntelligence`;
- keep raw vendor payloads out of the profile row;
- add approved fields to the operator scoring registry; and
- preserve missing-field omission when the vendor is unconfigured or unavailable.

That later append does not require redesigning or blocking the scoring engine. Until those fields
exist, scoring continues with present profile inputs.

## Unified `riskEvents` profile updater

The approved design now lives in
[`POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md`](POWEROTP_BOTBLOCKER_PHASE17A_RISK_REPORT_REDUCER_PLAN.md).
The middleware uses one report shape for the first session contact and every later update. Each
accepted report creates one immutable `riskEvents` row, receives an insert-time score from a
separate unseeded operator configuration, and atomically updates the linked profile's
`risk_events_sum` arithmetic average. That average is one configurable numeric input to the
existing overall profile scorer.

Detailed route/page, click, pointer, navigation, label, and full fingerprint data stays on the
90-day event row. Only direct, unambiguous numeric/count/presence fields enter the initial event
registry; less-obvious fields remain unavailable/off until explicitly designed. Missing fields
are omitted and never block the row or overall profile scorer.

## Atomic sequence, concurrency, and idempotency

Implementation must apply one initial request and fingerprint/session synchronization at most
once per gate session. The session-open operation must:

1. validate complete customer/project/site/session scope;
2. create the gate-session row from the complete initial request;
3. write that request as the initial immutable risk event;
4. bind or create the `userIntelligence` row through the signed site-return cookie, Passport, or
   exact raw-fingerprint comparison;
5. create or update its linked `fingerprintData` and `userIntelligence` rows;
6. update selected latest-successful fingerprint fields;
7. update current IP/history and exact-IP reuse counts;
8. conditionally mark that gate session's fingerprint/profile synchronization as applied;
9. refresh applicable retention timestamps; and
10. commit before current score recalculation or callback behavior uses the changed
   `userIntelligence` row.

After the session row exists, issue the 30-minute visitor token and persist only its token ID,
expiry, and one-way nonce/token digest metadata on that row before returning; never persist the
reusable bearer. The middleware writes the bearer to its server-side gate session. At minute 29
the middleware sends the refresh request; POWEROTP updates safe metadata on the same durable
session row and returns the rotated bearer for the middleware to replace in its gate session.
During `userIntelligence` creation/update, derive and store the versioned verify lookup hash from
the stable-source fields just written to that row; a missing hash never discards the raw records.

The conditional gate-session marker is the primary idempotency boundary. Concurrent exact
replays must produce one applied update and one idempotent duplicate result.

For different sessions concurrently linked to one profile:

- server observation time orders direct values;
- use a deterministic gate-session ID tie-breaker if timestamps are equal;
- an older session may complete storage of its own immutable/session data but cannot overwrite
  a newer current `fingerprintData` vector or newer direct profile fields;
- IP-history mutation must use atomic compare/update behavior so neither accepted change is
  silently lost; and
- scoring runs after the transaction on the final committed profile state and remains
  idempotent.

Stale/replayed reports cannot apply the gate-session synchronization twice. The existing unique
`riskEvents` sequence/index and gate-session monotonic sequence continue protecting detailed
session reports independently.

## Validation and failure rules

- Every number must be finite. Reject `NaN`, infinities, unsafe integers, and values outside the
  field contract.
- Component arrays/strings/objects require explicit item, length, and total-payload bounds.
- Use safe integer arithmetic for counts; reject or saturate only under an explicitly tested
  contract rather than allowing overflow.
- Never divide when the denominator is zero. Mark that derived input unavailable and omit it.
- Missing fingerprint component: store typed availability in `fingerprintData`; do not overwrite
  a previously successful selected profile field.
- Missing trusted IP: omit current-IP/history/reuse updates; never fabricate an address.
- Missing ASN classification score: omit `asnScore`; never substitute zero.
- Missing external vendor result: omit all external reputation fields.
- Missing verify-hash inputs: keep the saved raw vector and mark the user-row-derived lookup field
  unavailable; cookie, Passport, or exact raw-fingerprint matching may still identify the profile,
  but no fabricated hash or partial fuzzy match exists.
- Database/transaction failure: no partial profile/fingerprint/session application and no score
  or callback based on uncommitted data.

## Implementation split

This design is larger than one implementation session. Execute in fresh sessions:

1. **Status: complete (2026-08-17). Fingerprint contracts and collector.** Added the pinned
   dependency, monitoring-disabled once-per-session collection, strict POWEROTP-owned contracts,
   component availability mapping, initial authenticated bridge transport, and prohibited-data
   tests. See the dated Phase 17 fingerprint-contracts/collector entry in
   [`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md).
2. **Initial session persistence and identity binding.** Save the complete initial request as the
   session snapshot and first risk event; bind through the persistent user-intelligence cookie,
   Passport, or exact raw fingerprint; persist safe visitor-token metadata; write the bearer only
   to middleware server-side session state; and have middleware request/replace it at minute 29.
3. **`fingerprintData` persistence and verify lookup field.** Add collection/indexes, raw vector
   persistence, the bounded stable-source projection on `userIntelligence`, same-row
   creation/update HMAC derivation, retention, edge-publication input, and concurrency tests. Do
   not add inbound hash matching.
4. **Gate-session profile synchronization.** Add explicit blacklist observation, selected direct
   fingerprint fields, current IP, 20-entry unique LRU history, two sets of rolling reuse counts,
   and transactional at-most-once application.
5. **Profile scoring configuration/runtime.** Score present `userIntelligence` fields, including
   transient bounded history aggregates, while missing inputs remain excluded.
6. **Project callback/pull updates.** Notify middleware after committed profile/score changes
   using the existing project callback boundary and scoped visitor-token pull.
7. **Status: implementation in progress (2026-08-19); canonical contract/transport and
   event configuration/row-scoring slices complete. Unified risk report, row scoring, and
   profile average.** Follow the dedicated plan's remaining profile-average implementation
   session. The superseded parallel
   initial/behavior/risk ingestion paths have been removed.
8. **Deferred external IP profile/scoring integration.** Select a real vendor first, approve its
   bounded profile fields, then append and score them.

The canonical Phase 17 roadmap must be reconciled to this split before implementation claims are
made.

## Focused implementation verification expected later

No checks run for this documentation-only design session. Future implementation sessions should
verify only their touched workspaces:

- contracts boundary tests for every component, unavailable state, and prohibited field;
- browser collector tests proving once-per-session operation and `monitoring: false`;
- canonical HMAC test vectors and exclusion tests;
- exact matching and changed-hash replacement tests;
- one-record-per-profile `fingerprintData` concurrency;
- replay/stale/cross-project rejection;
- selected-field latest-successful synchronization;
- current-IP no-change and changed-IP transitions;
- unique LRU revisits and 20-entry trimming;
- exact global/same-site 1/7/30-day distinct-profile counts;
- no-IP/no-ASN/no-vendor behavior;
- finite/range/overflow/division-by-zero handling; and
- scoring omission for every unavailable input.

## Explicit exclusions

- No unified risk-report reducer runtime implementation in this design session.
- No seeded risk-event or user-intelligence scoring functions, weights, or thresholds.
- No live external IP-reputation vendor or vendor-field mapping.
- No hardcoded score formulas, weights, coefficients, thresholds, or customer sliders.
- No customer OTP policy, callback implementation, Passport, billing, Cloudflare/verify-server
  synchronization, deployment, migration, seed, or traffic activation.
- No fuzzy fingerprint matching, IP-only profile matching, hash aliases, CGNAT-private-address
  detection, or address-family risk.
- No as-built implementation entry until code actually ships.
