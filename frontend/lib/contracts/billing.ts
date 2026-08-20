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
  sessionId?: string;
  paymentProcessor?: string;
  paymentProcessorTransactionId?: string;
  paymentProcessorEventId?: string;
  paymentRequestId?: string;
  sourceTransactionId?: string;
  referralProcessed?: true;
  referralTransactionId?: string;
  adPayoutId?: string;
  adSettlementId?: string;
  thresholdRuleId?: string;
  referralCode?: string;
  commissionPercent?: number;
  commissionBaseUsd?: number;
  type:
    | "visit"
    | "call_reachability"
    | "voice_code"
    | "voice_challenge"
    | "sms_code"
    | "email_code"
    | "daily_charge"
    | "signup_threshold_charge"
    | "signin_threshold_charge"
    | "ad_revenue"
    | "signup_referral_credit"
    | "signin_referral_credit"
    | "ad_revenue_referral_credit"
    | "recurring_referral_credit"
    | "age_verification"
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
