import { z } from "zod";

import type { VerificationType } from "./verification.js";

/**
 * A customer's balance-tiered pricing tier — see `docs/AS_BUILT.md`'s
 * "Customer balance billing" section for the full design. Tier3 (the most
 * money on deposit) gets the cheapest per-unit rates; tier1 the most
 * expensive. The dollar boundaries themselves
 * (`apps/api/src/balance-service.ts#tierForBalance`) are fixed by product
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
 * balance billing" section. `otp1`..`otp4` map 1:1 to
 * `call_reachability`/`voice_code`/`voice_challenge`/`sms_code` in that
 * fixed order (see `otpChargeTypeFor` below).
 */
export const financialTransactionTypes = [
  "visit",
  "otp1",
  "otp2",
  "otp3",
  "otp4",
  "daily_charge",
  "topup",
] as const;
export const FinancialTransactionTypeSchema = z.enum(financialTransactionTypes);

/**
 * The one append-only ledger row shape. `amountUsd` is signed
 * (negative=charge, positive=credit); `openingBalanceUsd`/
 * `closingBalanceUsd` make any date-range total independently verifiable
 * without recomputation, since every row already carries its own
 * before/after balance.
 */
export const FinancialTransactionSchema = z.object({
  id: z.string().min(16),
  userId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  interactionId: z.string().min(1).optional(),
  stripePaymentId: z.string().min(1).optional(),
  type: FinancialTransactionTypeSchema,
  country: CountryCodeSchema.optional(),
  openingBalanceUsd: z.number(),
  tierAtTransaction: BillingTierSchema,
  amountUsd: z.number(),
  closingBalanceUsd: z.number(),
  createdAt: z.string().datetime(),
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

/** `call_reachability` -> `otp1`, `voice_code` -> `otp2`, `voice_challenge`
 * -> `otp3`, `sms_code` -> `otp4` — a fixed, stable mapping shared by every
 * billing surface (charging, admin displays), not re-derived ad hoc. */
export const otpChargeTypeFor: Record<VerificationType, (typeof financialTransactionTypes)[number]> = {
  call_reachability: "otp1",
  voice_code: "otp2",
  voice_challenge: "otp3",
  sms_code: "otp4",
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
export type FinancialTransactionsResponse = z.infer<typeof FinancialTransactionsResponseSchema>;
export type CustomerBalance = z.infer<typeof CustomerBalanceSchema>;
export type CreateTopup = z.infer<typeof CreateTopupSchema>;
export type TopupCheckout = z.infer<typeof TopupCheckoutSchema>;
export type CallRateCardsResponse = z.infer<typeof CallRateCardsResponseSchema>;
export type SmsRateCardsResponse = z.infer<typeof SmsRateCardsResponseSchema>;
export type PlanChargesResponse = z.infer<typeof PlanChargesResponseSchema>;
