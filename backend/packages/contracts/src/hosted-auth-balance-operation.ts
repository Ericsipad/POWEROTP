import { z } from "zod";

import { UsdDecimalSchema } from "./accounting.js";
import {
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
} from "./hosted-auth-ceremony-scopes.js";
import { HostedAuthRequestIdSchema } from "./hosted-auth-identifiers.js";

export const HostedAuthBalanceTransactionIdSchema = z
  .string()
  .min(16)
  .max(200)
  .brand<"HostedAuthBalanceTransactionId">();

export const HostedAuthBillableMethodSchema = z.enum([
  "powerotp_email",
  "powerotp_sms",
  "powerotp_voice",
  "didit_email",
  "didit_phone",
  "didit_age",
  "didit_kyc",
  "didit_liveness",
  "didit_biometric_authentication",
  "didit_recovery",
]);

export const HostedAuthBillableScopeSchema = z.union([
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
]);

type BalanceScope = z.infer<typeof HostedAuthBillableScopeSchema>;

const enforceBalanceScope = (
  value: {
    projectId: string;
    scope: BalanceScope;
    method: z.infer<typeof HostedAuthBillableMethodSchema>;
  },
  context: z.RefinementCtx,
) => {
  if (value.projectId !== value.scope.projectId) {
    context.addIssue({
      code: "custom",
      message: "Balance project must match the provider-operation scope",
      path: ["projectId"],
    });
  }

  const verificationMethodByPurpose: Record<string, string> = {
    age_assurance: "didit_age",
    identity_kyc_assurance: "didit_kyc",
    liveness_and_face_enrollment: "didit_liveness",
    fresh_biometric_authentication: "didit_biometric_authentication",
    recovery_proof: "didit_recovery",
  };
  const verificationMethod =
    verificationMethodByPurpose[value.scope.providerPurpose];
  const contactMethods =
    value.scope.realm.identityDataMode === "powerotp_pii"
      ? ["powerotp_email", "powerotp_sms", "powerotp_voice"]
      : ["didit_email", "didit_phone"];
  const methodMatches = verificationMethod
    ? value.method === verificationMethod
    : contactMethods.includes(value.method);
  if (!methodMatches) {
    context.addIssue({
      code: "custom",
      message: "Billable method does not match custody mode and provider purpose",
      path: ["method"],
    });
  }
};

const BalanceOperationBaseSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    projectId: z.string().min(16).max(200),
    scope: HostedAuthBillableScopeSchema,
    method: HostedAuthBillableMethodSchema,
  })
  .strict();

export const HostedAuthBalanceOperationRequestSchema =
  BalanceOperationBaseSchema.extend({
    amountUsd: UsdDecimalSchema,
    action: z.literal("debit_before_provider"),
  }).superRefine((value, context) => {
    enforceBalanceScope(value, context);
    if (value.amountUsd === "0" || /^0\.0+$/.test(value.amountUsd)) {
      context.addIssue({
        code: "custom",
        message: "Paid provider operations require a positive debit",
        path: ["amountUsd"],
      });
    }
  });

export const HostedAuthBalanceOperationResultSchema = z
  .discriminatedUnion("status", [
    BalanceOperationBaseSchema.extend({
      status: z.literal("debited"),
      balanceTransactionId: HostedAuthBalanceTransactionIdSchema,
    }),
    BalanceOperationBaseSchema.extend({
      status: z.literal("insufficient_balance"),
    }),
  ])
  .superRefine(enforceBalanceScope);

export interface HostedAuthBalanceOperator {
  debitBeforeProvider(
    request: HostedAuthBalanceOperationRequest,
  ): Promise<HostedAuthBalanceOperationResult>;
}

export type HostedAuthBalanceOperationRequest = z.infer<
  typeof HostedAuthBalanceOperationRequestSchema
>;
export type HostedAuthBalanceOperationResult = z.infer<
  typeof HostedAuthBalanceOperationResultSchema
>;
