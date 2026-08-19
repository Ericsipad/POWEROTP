import type { CustomerBalance, FinancialTransaction } from "@powerotp/contracts";

import type {
  CustomerBalanceDocument,
  FinancialTransactionDocument,
} from "./billing-persistence.js";
import { legacyOtpTypeMap } from "./billing-persistence.js";

export function toCustomerBalanceResponse(document: CustomerBalanceDocument): CustomerBalance {
  return {
    userId: document._id,
    balanceUsd: document.balanceUsd,
    tier: document.tier,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function canonicalTransactionType(
  type: FinancialTransactionDocument["type"],
): FinancialTransaction["type"] {
  switch (type) {
    case "otp1": return legacyOtpTypeMap.otp1;
    case "otp2": return legacyOtpTypeMap.otp2;
    case "otp3": return legacyOtpTypeMap.otp3;
    case "otp4": return legacyOtpTypeMap.otp4;
    case "otp5": return legacyOtpTypeMap.otp5;
    default: return type;
  }
}

export function toFinancialTransactionResponse(
  document: FinancialTransactionDocument,
): FinancialTransaction {
  return {
    id: document._id,
    userId: document.userId,
    projectId: document.projectId,
    interactionId: document.interactionId,
    sessionId: document.sessionId,
    paymentProcessor: document.paymentProcessor ?? (document.stripePaymentId ? "stripe" : undefined),
    paymentProcessorTransactionId:
      document.paymentProcessorTransactionId ?? document.stripePaymentId,
    sourceTransactionId: document.sourceTransactionId,
    adPayoutId: document.adPayoutId,
    adSettlementId: document.adSettlementId,
    thresholdRuleId: document.thresholdRuleId,
    referralCode: document.referralCode,
    commissionPercent: document.commissionPercent,
    commissionBaseUsd: document.commissionBaseUsd,
    type: canonicalTransactionType(document.type),
    country: document.country,
    note: document.note,
    openingBalanceUsd: document.openingBalanceUsd,
    tierAtTransaction: document.tierAtTransaction,
    amountUsd: document.amountUsd,
    closingBalanceUsd: document.closingBalanceUsd,
    createdAt: document.createdAt.toISOString(),
  };
}
