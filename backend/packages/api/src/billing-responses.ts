import type { CustomerBalance, FinancialTransaction } from "@powerotp/contracts";

import type {
  CustomerBalanceDocument,
  FinancialTransactionDocument,
} from "./billing-persistence.js";

export function toCustomerBalanceResponse(document: CustomerBalanceDocument): CustomerBalance {
  return {
    userId: document._id,
    balanceUsd: document.balanceUsd,
    tier: document.tier,
    updatedAt: document.updatedAt.toISOString(),
  };
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
    paymentProcessor: document.paymentProcessor,
    paymentProcessorTransactionId: document.paymentProcessorTransactionId,
    paymentProcessorEventId: document.paymentProcessorEventId,
    paymentRequestId: document.paymentRequestId,
    sourceTransactionId: document.sourceTransactionId,
    referralProcessed: document.referralProcessed,
    referralTransactionId: document.referralTransactionId,
    adPayoutId: document.adPayoutId,
    adSettlementId: document.adSettlementId,
    thresholdRuleId: document.thresholdRuleId,
    referralCode: document.referralCode,
    commissionPercent: document.commissionPercent,
    commissionBaseUsd: document.commissionBaseUsd,
    type: document.type,
    country: document.country,
    note: document.note,
    openingBalanceUsd: document.openingBalanceUsd,
    tierAtTransaction: document.tierAtTransaction,
    amountUsd: document.amountUsd,
    closingBalanceUsd: document.closingBalanceUsd,
    createdAt: document.createdAt.toISOString(),
  };
}
