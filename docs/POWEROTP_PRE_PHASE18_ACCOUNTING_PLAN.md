# Pre-Phase-18 Accounting Foundation Plan

**Approved and implemented:** 2026-08-19

This accounting prerequisite is intentionally separate from Phase 18 customer risk/OTP policy.
It extends the existing transactional customer balance and append-only ledger instead of creating
a second account or project balance system.

## Locked product decisions

- `financialTransactions` remains the only monetary ledger and `customerBalances` remains its
  transactionally updated current-balance projection.
- New payment rows identify both `paymentProcessor` and
  `paymentProcessorTransactionId`. Processor transaction IDs are not globally unique without
  their processor namespace. Historical `stripePaymentId` values remain immutable history.
- OTP transaction types are the exact verification methods: `call_reachability`, `voice_code`,
  `voice_challenge`, `sms_code`, and `email_code`.
- Customer-site signup/signin events are trusted server-to-server project reports. Browser code
  cannot author events, counts, slots, charge amounts, payout values, or referral recipients.
- Admins may add any number of signup/signin threshold rows. A project is eligible when its true
  trailing-30-day count reaches a configured threshold and that project/rule has not charged in
  the preceding 31 days. The owning account's balance tier is resolved inside the charge
  transaction.
- Each ad system has one admin-entered gross USD payout pool per complete UTC calendar day. The
  worker allocates that pool among projects in proportion to filled slots.
- The admin payout calendar exposes the latest ten complete UTC days. A missed day may be entered
  later while it remains in that window, and each entered system/day settles exactly once.
- Project referral attribution and account referral attribution are independent. Project events
  and project recurring charges use the project's referral. Account attribution is retained for
  account-level services.
- Referral commission is an additional credit to the referrer based on the gross source row. It
  does not reduce or rewrite the project owner's debit or credit. Recurring commission uses the
  actual daily charge, not the monthly display amount.
- Referral landing attribution lasts 30 days. The first valid code wins and is consumed by the
  next successful account signup.
- No payment processor, ad system, payout, threshold, rate, commission percentage, referral code,
  or customer data is seeded.

## Authoritative collections

### Existing financial authority

- `financialTransactions`: immutable source, charge, credit, top-up, adjustment, and commission
  rows with opening balance, tier, signed amount, and closing balance.
- `customerBalances`: current balance/tier projection, written only in the same transaction as its
  ledger row.
- `billingIdempotencyClaims`: permanent claims for retry-safe monetary batches.

### Project event and ad accounting

- `projectAuthSessions`: immutable project/session/event/timestamp/ad-system/allotted/filled
  reports plus project-scoped idempotency key.
- `adSystems`: admin-created ad-system identity and active state.
- `adDailyPayouts`: one entered payout pool and settlement state per ad system/UTC day.
- `adDailySettlements`: immutable project allocation linked to the parent payout and resulting
  owner/referral ledger rows.

### Thresholds and referrals

- `billingThresholdRules`: event type, positive threshold, three tier amounts, active state, and
  stable rule identity.
- `projectThresholdChargeStates`: project/rule last-charge timestamp, observed count, tier, and
  ledger transaction.
- `referralCodes`: unique normalized customer-created names with reserved-name protection.
- `accountReferralAttributions`: immutable first-touch account attribution.
- `projectReferralAttributions`: historical project referral periods; replacement closes the old
  row and affects future transactions only.
- `referralCommissionSettings`: one admin-managed set of bounded percentages for signup charges,
  signin charges, ad deposits, and recurring project charges.

## Money and settlement invariants

- Related owner and referrer rows use one ordered multi-account MongoDB transaction.
- Source rows, referral rows, balance projections, idempotency claims, settlement rows, and
  threshold state commit or roll back together.
- Every referral row links to its immutable source transaction and snapshots the commission base
  and percentage.
- Ad payout input is validated to at most six decimal places and converted to integer micro-USD.
- Project ad allocation floors each proportional share, then distributes remaining micros by
  largest fractional remainder with project ID as the deterministic tie-breaker.
- Allocated project credits always sum exactly to the entered ad-system/day payout.
- A zero-filled day, unknown/inactive ad system, or failed write leaves the payout explicitly
  unsettled/failed and creates no partial credits.
- A settled payout is immutable. Corrections use explicit financial adjustments rather than
  rewriting settlement history.

## Protected flows

### Project session ingestion

1. Authenticate the project API credential.
2. Apply project/IP rate limiting.
3. Require a bounded project-scoped idempotency key.
4. Validate the closed signup/signin report, timestamp, nonnegative slot counts, and
   `filled <= allotted`.
5. Persist once; an exact retry returns the existing result and a conflicting retry is rejected.

### Daily accounting worker

1. Scan entered/failed payouts in the latest ten complete UTC days.
2. Aggregate immutable filled slots by project and allocate each entered daily pool.
3. Evaluate active signup/signin threshold rules against the preceding 30 days and enforce the
   31-day project/rule cooldown.
4. Apply the existing active-project daily recurring charge.
5. Add configured project-referral commissions to eligible source rows.
6. Record explicit failed state and immutable audit events without stopping unrelated projects.

### Referral attribution

1. A customer creates one active, normalized, non-reserved referral code.
2. `powerotp.com/{code}` validates the code and sets the first-touch 30-day SameSite cookie.
3. Successful signup resolves and persists a non-self immutable account attribution.
4. An authenticated project owner may set, replace, or clear that project's separate referral.
5. Historical transaction and attribution rows are never rewritten.

## Customer and admin surfaces

- Account billing continues to show the master balance and full ledger.
- Project cards show trailing-30-day signup/signin counts, project referral assignment, and
  project-filtered transactions.
- The customer dashboard exposes account referral-link creation.
- The admin accounting panel manages ad systems, the latest-ten-days payout calendar, threshold
  rows, and four referral commission percentages.
- Every mutation uses the existing customer/admin session, CSRF, ownership, audit, rate-limit, and
  idempotency boundaries appropriate to its traffic class.

## Verification and exclusions

Tests cover closed schemas, exact OTP types, provider-qualified payment identity, payout precision
and deterministic allocation, zero-filled days, payout immutability, project-event idempotency,
timestamp bounds, 30-day counts, exact 31-day cooldown, multi-account source/commission linkage,
self-referral, first-touch attribution, route inventory, and existing OTP/top-up/daily-charge
behavior.

Focused contracts, API, backend production, backend route, and frontend checks passed, followed by
a clean root `npm run verify`.

This prerequisite does not implement Phase 18 customer risk/OTP policy, Phase 19 orchestration,
automatic OTP opening, Passport, CleanDataPages, visitor billing, PaidTokenPass, edge publication,
Shopify, or external IP-reputation integration.
