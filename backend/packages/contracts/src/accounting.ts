import { z } from "zod";

export const ProjectAuthEventTypeSchema = z.enum(["signup", "signin"]);
export const AdSystemIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{1,63}$/, "Use a lowercase ad-system identifier");
export const ServiceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const UsdDecimalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a nonnegative USD amount with at most 6 decimals");

export const ProjectAuthSessionReportSchema = z
  .object({
    sessionId: z.string().min(16).max(200),
    eventType: ProjectAuthEventTypeSchema,
    occurredAt: z.string().datetime(),
    adSlotsAllotted: z.number().int().nonnegative(),
    adSlotsFilled: z.number().int().nonnegative(),
    adSystemId: AdSystemIdSchema,
  })
  .strict()
  .refine((value) => value.adSlotsFilled <= value.adSlotsAllotted, {
    message: "Filled ad slots cannot exceed allotted slots",
    path: ["adSlotsFilled"],
  });

export const AdSystemSchema = z
  .object({
    id: AdSystemIdSchema,
    displayName: z.string().trim().min(1).max(100),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const UpsertAdSystemSchema = AdSystemSchema.pick({
  id: true,
  displayName: true,
  active: true,
});

export const AdDailyPayoutInputSchema = z
  .object({
    adSystemId: AdSystemIdSchema,
    serviceDate: ServiceDateSchema,
    grossPayoutUsd: UsdDecimalSchema,
  })
  .strict();

export const AdDailyPayoutSchema = AdDailyPayoutInputSchema.extend({
  id: z.string().min(16),
  totalFilledSlots: z.number().int().nonnegative().optional(),
  status: z.enum(["entered", "settled", "failed"]),
  failureReason: z.string().min(1).max(100).optional(),
  enteredAt: z.string().datetime(),
  settledAt: z.string().datetime().optional(),
}).strict();

const tierAmounts = {
  tier1ChargeUsd: z.number().nonnegative(),
  tier2ChargeUsd: z.number().nonnegative(),
  tier3ChargeUsd: z.number().nonnegative(),
};
export const BillingThresholdRuleInputSchema = z
  .object({
    eventType: ProjectAuthEventTypeSchema,
    thresholdCount: z.number().int().positive(),
    ...tierAmounts,
    active: z.boolean(),
  })
  .strict();
export const BillingThresholdRuleSchema = BillingThresholdRuleInputSchema.extend({
  id: z.string().min(16),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export const UpdateBillingThresholdRuleSchema = BillingThresholdRuleInputSchema.pick({
  tier1ChargeUsd: true,
  tier2ChargeUsd: true,
  tier3ChargeUsd: true,
  active: true,
});

export const ReferralCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "Use 3-40 lowercase letters, numbers, or hyphens");
export const CreateReferralCodeSchema = z.object({ code: ReferralCodeSchema }).strict();
export const SetProjectReferralSchema = z.object({ code: ReferralCodeSchema.nullable() }).strict();

export const ReferralCommissionSettingsInputSchema = z
  .object({
    signupChargePercent: z.number().min(0).max(100),
    signinChargePercent: z.number().min(0).max(100),
    adDepositPercent: z.number().min(0).max(100),
    recurringChargePercent: z.number().min(0).max(100),
  })
  .strict();
export const ReferralCommissionSettingsSchema = ReferralCommissionSettingsInputSchema.extend({
  updatedAt: z.string().datetime(),
}).strict();

export const ProjectAccountingSummarySchema = z
  .object({
    projectId: z.string().min(1),
    signupCount30Days: z.number().int().nonnegative(),
    signinCount30Days: z.number().int().nonnegative(),
    referralCode: ReferralCodeSchema.optional(),
  })
  .strict();

export const AccountingAdminConfigSchema = z
  .object({
    adSystems: z.array(AdSystemSchema),
    thresholds: z.array(BillingThresholdRuleSchema),
    commissions: ReferralCommissionSettingsSchema.nullable(),
    payouts: z.array(AdDailyPayoutSchema),
  })
  .strict();

export type ProjectAuthEventType = z.infer<typeof ProjectAuthEventTypeSchema>;
export type ProjectAuthSessionReport = z.infer<typeof ProjectAuthSessionReportSchema>;
export type AdSystem = z.infer<typeof AdSystemSchema>;
export type UpsertAdSystem = z.infer<typeof UpsertAdSystemSchema>;
export type AdDailyPayoutInput = z.infer<typeof AdDailyPayoutInputSchema>;
export type BillingThresholdRuleInput = z.infer<typeof BillingThresholdRuleInputSchema>;
export type ReferralCommissionSettingsInput = z.infer<typeof ReferralCommissionSettingsInputSchema>;
