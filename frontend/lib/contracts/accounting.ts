import type { FinancialTransaction } from "./billing";

export interface AdSystem {
  id: string;
  displayName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingThresholdRule {
  id: string;
  eventType: "signup" | "signin";
  thresholdCount: number;
  tier1ChargeUsd: number;
  tier2ChargeUsd: number;
  tier3ChargeUsd: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralCommissionSettings {
  signupChargePercent: number;
  signinChargePercent: number;
  adDepositPercent: number;
  recurringChargePercent: number;
  updatedAt: string;
}

export interface AdDailyPayout {
  id: string;
  adSystemId: string;
  serviceDate: string;
  grossPayoutUsd: string;
  totalFilledSlots?: number;
  status: "entered" | "settled" | "failed";
  failureReason?: string;
  enteredAt: string;
  settledAt?: string;
}

export interface AccountingAdminConfig {
  adSystems: AdSystem[];
  thresholds: BillingThresholdRule[];
  commissions: ReferralCommissionSettings | null;
  payouts: AdDailyPayout[];
  serviceDates: string[];
}

export interface ProjectAccounting {
  projectId: string;
  signupCount30Days: number;
  signinCount30Days: number;
  referralCode?: string;
  transactions: FinancialTransaction[];
}
