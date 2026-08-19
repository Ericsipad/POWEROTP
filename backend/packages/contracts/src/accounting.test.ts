import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdDailyPayoutInputSchema,
  BillingThresholdRuleInputSchema,
  FinancialTransactionSchema,
  ProjectAuthSessionReportSchema,
  ReferralCommissionSettingsInputSchema,
} from "./index.js";

describe("accounting contracts", () => {
  it("accepts exact OTP method types and generic processor identity", () => {
    const parsed = FinancialTransactionSchema.parse({
      id: "txn_1234567890123456",
      userId: "usr_1",
      paymentProcessor: "processor_two",
      paymentProcessorTransactionId: "shared-id",
      type: "voice_challenge",
      openingBalanceUsd: 10,
      tierAtTransaction: "tier1",
      amountUsd: -1,
      closingBalanceUsd: 9,
      createdAt: new Date().toISOString(),
    });
    assert.equal(parsed.type, "voice_challenge");
    assert.equal(parsed.paymentProcessor, "processor_two");
    assert.equal(FinancialTransactionSchema.safeParse({ ...parsed, type: "otp3" }).success, false);
  });

  it("rejects malformed or overfilled project session reports", () => {
    const valid = {
      sessionId: "ses_1234567890123456",
      eventType: "signup",
      occurredAt: new Date().toISOString(),
      adSlotsAllotted: 2,
      adSlotsFilled: 2,
      adSystemId: "ads_one",
    };
    assert.equal(ProjectAuthSessionReportSchema.safeParse(valid).success, true);
    assert.equal(
      ProjectAuthSessionReportSchema.safeParse({ ...valid, adSlotsFilled: 3 }).success,
      false,
    );
    assert.equal(ProjectAuthSessionReportSchema.safeParse({ ...valid, extra: true }).success, false);
  });

  it("bounds payout precision, thresholds, and commission percentages", () => {
    assert.equal(
      AdDailyPayoutInputSchema.safeParse({
        adSystemId: "ads_one",
        serviceDate: "2026-08-18",
        grossPayoutUsd: "12.123456",
      }).success,
      true,
    );
    assert.equal(
      AdDailyPayoutInputSchema.safeParse({
        adSystemId: "ads_one",
        serviceDate: "2026-08-18",
        grossPayoutUsd: "12.1234567",
      }).success,
      false,
    );
    assert.equal(
      BillingThresholdRuleInputSchema.safeParse({
        eventType: "signin",
        thresholdCount: 0,
        tier1ChargeUsd: 1,
        tier2ChargeUsd: 2,
        tier3ChargeUsd: 3,
        active: true,
      }).success,
      false,
    );
    assert.equal(
      ReferralCommissionSettingsInputSchema.safeParse({
        signupChargePercent: 101,
        signinChargePercent: 0,
        adDepositPercent: 0,
        recurringChargePercent: 0,
      }).success,
      false,
    );
  });
});
