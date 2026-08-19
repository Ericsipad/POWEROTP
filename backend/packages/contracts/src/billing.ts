import { z } from "zod";

import { verificationTypes, type VerificationType } from "./verification.js";

/**
 * A customer's balance-tiered pricing tier — see `docs/AS_BUILT.md`'s
 * "Customer balance billing" section for the full design. Tier3 (the most
 * money on deposit) gets the cheapest per-unit rates; tier1 the most
 * expensive. The dollar boundaries themselves
 * (`backend/packages/api/src/balance-service.ts#tierForBalance`) are fixed by product
 * decision, not admin-configurable; the *rates* charged per tier are.
 */
export const billingTiers = ["tier1", "tier2", "tier3"] as const;
export const BillingTierSchema = z.enum(billingTiers);

/** ISO 3166-1 alpha-2 country code, e.g. `"US"`, `"TH"` — resolved from a
 * verification's own E.164 `targetNumber` via `libphonenumber-js`, never
 * guessed from a hand-rolled prefix table. */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code");

/**
 * Admin-entered per-country, per-tier call rate (USD per minute), shared by
 * all three voice verification types (`call_reachability`/`voice_code`/
 * `voice_challenge`) — a VoIP.ms per-minute cost doesn't depend on which OTP
 * type placed the call.
 */
export const CallRateCardSchema = z.object({
  countryCode: CountryCodeSchema,
  tier1PerMinuteUsd: z.number().nonnegative(),
  tier2PerMinuteUsd: z.number().nonnegative(),
  tier3PerMinuteUsd: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});

/** Same shape as `CallRateCardSchema`, per SMS message instead of per
 * minute, for `sms_code`. */
export const SmsRateCardSchema = z.object({
  countryCode: CountryCodeSchema,
  tier1PerMessageUsd: z.number().nonnegative(),
  tier2PerMessageUsd: z.number().nonnegative(),
  tier3PerMessageUsd: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const UpsertCallRateCardSchema = CallRateCardSchema.omit({ updatedAt: true });
export const UpsertSmsRateCardSchema = SmsRateCardSchema.omit({ updatedAt: true });

/**
 * `email_code`'s rate chart, per tier — deliberately a single flat global
 * rate, not per-country like `CallRateCardSchema`/`SmsRateCardSchema`:
 * Brevo's own per-email sending cost isn't country-dependent, so there is
 * nothing for a country dimension to express here. Exactly one document
 * ever exists (see `backend/packages/api/src/billing-persistence.ts`'s fixed `_id`).
 */
export const EmailRateSchema = z.object({
  tier1PerEmailUsd: z.number().nonnegative(),
  tier2PerEmailUsd: z.number().nonnegative(),
  tier3PerEmailUsd: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});
export const UpsertEmailRateSchema = EmailRateSchema.omit({ updatedAt: true });

/**
 * The "shown as monthly, charged daily" plan fee per tier — both values are
 * independently admin-entered (never derived from each other by dividing by
 * 30), matching the product framing of "we show it as a monthly $10 ...
 * charged daily".
 */
export const PlanChargeSchema = z.object({
  tier: BillingTierSchema,
  monthlyDisplayUsd: z.number().nonnegative(),
  dailyChargedUsd: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const UpdatePlanChargeSchema = PlanChargeSchema.omit({ updatedAt: true });

/**
 * One row per ledger-affecting event. `visit` is reserved for the future
 * BotBlocker/gate-adapter product (per-site-visitor gate checks) — no real
 * charging logic exists for it yet; see `docs/AS_BUILT.md`'s "Customer
 * balance billing" section. OTP rows use their exact verification method
 * (`call_reachability`/`voice_code`/`voice_challenge`/`sms_code`/`email_code`).
 * New-account free
 * usage (see `backend/packages/api/src/usage-quota-service.ts`) is a simple per-type
 * rolling counter, not a dollar credit, so it has no dedicated ledger type
 * of its own — a free-quota-covered interaction still writes a normal
 * OTP row, just always at `amountUsd: 0` with
 * `note: "free_quota"` (see `backend/packages/api/src/billing-charge-service.ts`), so it
 * stays fully visible in the same ledger/reports every real charge appears
 * in.
 * `admin_adjustment` is a manual support credit/debit
 * (`POST /v1/admin/billing/credit`), added for the "Customer signup flow"
 * work — see `docs/AS_BUILT.md`.
 */
export const financialTransactionTypes = [
  "visit",
  ...verificationTypes,
  "daily_charge",
  "signup_threshold_charge",
  "signin_threshold_charge",
  "ad_revenue",
  "referral_commission",
  "age_verification",
  "topup",
  "admin_adjustment",
] as const;
export const FinancialTransactionTypeSchema = z.enum(financialTransactionTypes);

export const PaymentProcessorSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{1,31}$/, "Use a lowercase payment processor identifier");

/**
 * The one append-only ledger row shape. `amountUsd` is signed
 * (negative=charge, positive=credit); `openingBalanceUsd`/
 * `closingBalanceUsd` make any date-range total independently verifiable
 * without recomputation, since every row already carries its own
 * before/after balance. `note` is a short annotation, populated for
 * `admin_adjustment` rows (the admin's stated reason) and for free-quota-
 * covered OTP rows (always the literal `"free_quota"`, so a $0
 * row from free usage is distinguishable in reports from a real $0 charge
 * caused by a missing rate — see `backend/packages/api/src/usage-quota-service.ts` and
 * `backend/packages/api/src/billing-charge-service.ts`).
 */
export const FinancialTransactionSchema = z.object({
  id: z.string().min(16),
  userId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  interactionId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  paymentProcessor: PaymentProcessorSchema.optional(),
  paymentProcessorTransactionId: z.string().min(1).max(200).optional(),
  sourceTransactionId: z.string().min(1).optional(),
  adPayoutId: z.string().min(1).optional(),
  adSettlementId: z.string().min(1).optional(),
  thresholdRuleId: z.string().min(1).optional(),
  referralCode: z.string().min(1).max(40).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  commissionBaseUsd: z.number().nonnegative().optional(),
  type: FinancialTransactionTypeSchema,
  country: CountryCodeSchema.optional(),
  note: z.string().min(1).max(200).optional(),
  openingBalanceUsd: z.number(),
  tierAtTransaction: BillingTierSchema,
  amountUsd: z.number(),
  closingBalanceUsd: z.number(),
  createdAt: z.string().datetime(),
});

/**
 * Admin manual balance credit/debit (`POST /v1/admin/billing/credit`) — the
 * only way to adjust a customer's balance today outside of the automated
 * charge/credit paths, e.g. for support cases. `amountUsd` is signed
 * (positive=credit, negative=debit).
 */
export const AdjustBalanceSchema = z.object({
  userId: z.string().min(1),
  amountUsd: z.number().refine((value) => value !== 0, "Amount must be nonzero"),
  note: z.string().trim().min(1).max(200).optional(),
});

export const FinancialTransactionsResponseSchema = z.object({
  transactions: z.array(FinancialTransactionSchema),
});

export const CustomerBalanceSchema = z.object({
  userId: z.string().min(1),
  balanceUsd: z.number(),
  tier: BillingTierSchema,
  updatedAt: z.string().datetime(),
});

/** Stripe top-ups are fixed amounts only — no arbitrary custom amount. */
export const topupAmountsUsd = [5, 25, 50, 100] as const;
export const TopupAmountSchema = z.union([
  z.literal(5),
  z.literal(25),
  z.literal(50),
  z.literal(100),
]);

export const CreateTopupSchema = z.object({ amountUsd: TopupAmountSchema });
export const TopupCheckoutSchema = z.object({ checkoutUrl: z.string().url() });

export const CallRateCardsResponseSchema = z.object({ rates: z.array(CallRateCardSchema) });
export const SmsRateCardsResponseSchema = z.object({ rates: z.array(SmsRateCardSchema) });
export const PlanChargesResponseSchema = z.object({ plans: z.array(PlanChargeSchema) });
/** Exactly one flat rate (or none, before an admin ever sets it) — never a
 * list, unlike the per-country call/SMS charts above. */
export const EmailRateResponseSchema = z.object({ rate: EmailRateSchema.nullable() });

/** Exact stable OTP method names shared by every billing surface. */
export const otpChargeTypeFor: Record<VerificationType, (typeof financialTransactionTypes)[number]> = {
  call_reachability: "call_reachability",
  voice_code: "voice_code",
  voice_challenge: "voice_challenge",
  sms_code: "sms_code",
  email_code: "email_code",
};

export type BillingTier = z.infer<typeof BillingTierSchema>;
export type CallRateCard = z.infer<typeof CallRateCardSchema>;
export type SmsRateCard = z.infer<typeof SmsRateCardSchema>;
export type UpsertCallRateCard = z.infer<typeof UpsertCallRateCardSchema>;
export type UpsertSmsRateCard = z.infer<typeof UpsertSmsRateCardSchema>;
export type PlanCharge = z.infer<typeof PlanChargeSchema>;
export type UpdatePlanCharge = z.infer<typeof UpdatePlanChargeSchema>;
export type FinancialTransactionType = z.infer<typeof FinancialTransactionTypeSchema>;
export type FinancialTransaction = z.infer<typeof FinancialTransactionSchema>;
export type AdjustBalance = z.infer<typeof AdjustBalanceSchema>;
export type FinancialTransactionsResponse = z.infer<typeof FinancialTransactionsResponseSchema>;
export type CustomerBalance = z.infer<typeof CustomerBalanceSchema>;
export type CreateTopup = z.infer<typeof CreateTopupSchema>;
export type TopupCheckout = z.infer<typeof TopupCheckoutSchema>;
export type CallRateCardsResponse = z.infer<typeof CallRateCardsResponseSchema>;
export type SmsRateCardsResponse = z.infer<typeof SmsRateCardsResponseSchema>;
export type PlanChargesResponse = z.infer<typeof PlanChargesResponseSchema>;
export type EmailRate = z.infer<typeof EmailRateSchema>;
export type UpsertEmailRate = z.infer<typeof UpsertEmailRateSchema>;
export type EmailRateResponse = z.infer<typeof EmailRateResponseSchema>;
