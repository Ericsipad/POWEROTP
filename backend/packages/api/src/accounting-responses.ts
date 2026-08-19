import { microsToUsdDecimal } from "./accounting-money.js";
import type {
  AdDailyPayoutDocument,
  AdSystemDocument,
  BillingThresholdRuleDocument,
  ReferralCommissionSettingsDocument,
} from "./accounting-persistence.js";

export function toAdSystemResponse(document: AdSystemDocument) {
  return {
    id: document._id,
    displayName: document.displayName,
    active: document.active,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toAdPayoutResponse(document: AdDailyPayoutDocument) {
  return {
    id: document._id,
    adSystemId: document.adSystemId,
    serviceDate: document.serviceDate,
    grossPayoutUsd: microsToUsdDecimal(document.grossPayoutMicros),
    totalFilledSlots: document.totalFilledSlots,
    status: document.status,
    failureReason: document.failureReason,
    enteredAt: document.enteredAt.toISOString(),
    settledAt: document.settledAt?.toISOString(),
  };
}

export function toThresholdResponse(document: BillingThresholdRuleDocument) {
  return {
    id: document._id,
    eventType: document.eventType,
    thresholdCount: document.thresholdCount,
    tier1ChargeUsd: document.tier1ChargeUsd,
    tier2ChargeUsd: document.tier2ChargeUsd,
    tier3ChargeUsd: document.tier3ChargeUsd,
    active: document.active,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toCommissionResponse(document: ReferralCommissionSettingsDocument | null) {
  return document
    ? {
        signupChargePercent: document.signupChargePercent,
        signinChargePercent: document.signinChargePercent,
        adDepositPercent: document.adDepositPercent,
        recurringChargePercent: document.recurringChargePercent,
        updatedAt: document.updatedAt.toISOString(),
      }
    : null;
}
