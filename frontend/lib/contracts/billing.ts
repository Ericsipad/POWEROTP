export type BillingTier = "tier1" | "tier2" | "tier3";

export interface CallRateCard {
  countryCode: string;
  tier1PerMinuteUsd: number;
  tier2PerMinuteUsd: number;
  tier3PerMinuteUsd: number;
  updatedAt: string;
}

export interface SmsRateCard {
  countryCode: string;
  tier1PerMessageUsd: number;
  tier2PerMessageUsd: number;
  tier3PerMessageUsd: number;
  updatedAt: string;
}

export interface EmailRate {
  tier1PerEmailUsd: number;
  tier2PerEmailUsd: number;
  tier3PerEmailUsd: number;
  updatedAt: string;
}

export interface PlanCharge {
  tier: BillingTier;
  monthlyDisplayUsd: number;
  dailyChargedUsd: number;
  updatedAt: string;
}

export interface FinancialTransaction {
  id: string;
  userId: string;
  projectId?: string;
  interactionId?: string;
  stripePaymentId?: string;
  type:
    | "visit"
    | "otp1"
    | "otp2"
    | "otp3"
    | "otp4"
    | "otp5"
    | "daily_charge"
    | "topup"
    | "admin_adjustment";
  country?: string;
  note?: string;
  openingBalanceUsd: number;
  tierAtTransaction: BillingTier;
  amountUsd: number;
  closingBalanceUsd: number;
  createdAt: string;
}

export interface CustomerBalance {
  userId: string;
  balanceUsd: number;
  tier: BillingTier;
  updatedAt: string;
}
