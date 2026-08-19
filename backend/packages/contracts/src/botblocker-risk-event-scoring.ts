import { z } from "zod";

import {
  findInvalidScoringFieldOperator,
  ProfileFieldScoreExpressionSchema,
  ProfileScoreFinalExpressionSchema,
  ProfileScoreStatusSchema,
  type ScoringFieldInputType,
} from "./botblocker-scoring.js";

export const riskEventScoreableFields = [
  { field: "request.method", inputType: "string" },
  { field: "clicks.totalCount", inputType: "number" },
  { field: "clicks.button.count", inputType: "number" },
  { field: "clicks.link.count", inputType: "number" },
  { field: "clicks.form_field.count", inputType: "number" },
  { field: "clicks.form_submit.count", inputType: "number" },
  { field: "clicks.navigation.count", inputType: "number" },
  { field: "clicks.honeypot.count", inputType: "number" },
  { field: "clicks.other.count", inputType: "number" },
  { field: "mouseDirectness.averageDirectnessRatio", inputType: "number" },
  { field: "mouseDirectness.sampleCount", inputType: "number" },
  { field: "scroll.smoothnessScore", inputType: "number" },
  { field: "scroll.highSpeedEventCount", inputType: "number" },
  { field: "honeypotActivations.count", inputType: "number" },
  { field: "pageView.durationMs", inputType: "number" },
  { field: "pageView.activeDurationMs", inputType: "number" },
  { field: "pageView.documentWidth", inputType: "number" },
  { field: "pageView.documentHeight", inputType: "number" },
  { field: "pageView.pointerHeatmap.occupiedBinCount", inputType: "number" },
  { field: "pageView.pointerHeatmap.totalSampleCount", inputType: "number" },
  { field: "pageView.pointerHeatmap.totalDwellMs", inputType: "number" },
  { field: "automationIndicators.webdriver.present", inputType: "number" },
  { field: "automationIndicators.untrusted_pointer.present", inputType: "number" },
  { field: "automationIndicators.untrusted_click.present", inputType: "number" },
  { field: "automationIndicators.untrusted_scroll.present", inputType: "number" },
  { field: "riskSignals.honeypot_activation.count", inputType: "number" },
  { field: "riskSignals.automation_indicator.count", inputType: "number" },
  { field: "riskSignals.velocity_anomaly.count", inputType: "number" },
  { field: "riskSignals.challenge_failure.count", inputType: "number" },
] as const satisfies readonly {
  field: string;
  inputType: Extract<ScoringFieldInputType, "number" | "string">;
}[];

export const RiskEventScoreableFieldSchema = z.enum(
  riskEventScoreableFields.map(({ field }) => field) as [
    (typeof riskEventScoreableFields)[number]["field"],
    ...(typeof riskEventScoreableFields)[number]["field"][],
  ],
);
export const RiskEventScoreableFieldRegistrySchema = z
  .array(
    z
      .object({
        field: RiskEventScoreableFieldSchema,
        inputType: z.enum(["number", "string"]),
      })
      .strict(),
  )
  .length(riskEventScoreableFields.length);

export const RiskEventFieldScoreExpressionSchema =
  ProfileFieldScoreExpressionSchema;
export const RiskEventScoreFinalExpressionSchema =
  ProfileScoreFinalExpressionSchema;
export const RiskEventScoreStatusSchema = ProfileScoreStatusSchema;

export const RiskEventScoringFieldConfigurationSchema = z
  .object({
    field: RiskEventScoreableFieldSchema,
    enabled: z.boolean(),
    expression: RiskEventFieldScoreExpressionSchema,
    weight: z
      .number()
      .finite()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const riskEventInputTypes = new Map(
  riskEventScoreableFields.map(({ field, inputType }) => [field, inputType]),
);

export const RiskEventScoringConfigurationSchema = z
  .object({
    fields: z
      .array(RiskEventScoringFieldConfigurationSchema)
      .max(riskEventScoreableFields.length),
    finalExpression: RiskEventScoreFinalExpressionSchema,
  })
  .strict()
  .superRefine((configuration, context) => {
    const seen = new Set<string>();
    for (const [index, field] of configuration.fields.entries()) {
      if (seen.has(field.field)) {
        context.addIssue({
          code: "custom",
          message: "Each scoreable field may be configured at most once",
          path: ["fields", index, "field"],
        });
      }
      seen.add(field.field);
      const invalidOperator = findInvalidScoringFieldOperator(
        field.expression,
        riskEventInputTypes.get(field.field)!,
      );
      if (invalidOperator) {
        context.addIssue({
          code: "custom",
          message: `${invalidOperator} is not supported for ${
            riskEventInputTypes.get(field.field)
          }`,
          path: ["fields", index, "expression"],
        });
      }
    }
  });

export const OperatorRiskEventScoringConfigurationMutationSchema = z
  .object({ configuration: RiskEventScoringConfigurationSchema })
  .strict();
const ConfiguredRiskEventScoringResponseSchema = z
  .object({
    status: z.literal("configured"),
    registry: RiskEventScoreableFieldRegistrySchema,
    configuration: RiskEventScoringConfigurationSchema,
    updatedBy: z.string().min(16).max(128),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const OperatorRiskEventScoringConfigurationResponseSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("unconfigured"),
        registry: RiskEventScoreableFieldRegistrySchema,
      })
      .strict(),
    ConfiguredRiskEventScoringResponseSchema,
  ]);
export const OperatorRiskEventScoringConfigurationMutationResponseSchema =
  ConfiguredRiskEventScoringResponseSchema;

export type RiskEventScoreableField = z.infer<
  typeof RiskEventScoreableFieldSchema
>;
export type RiskEventFieldScoreExpression = z.infer<
  typeof RiskEventFieldScoreExpressionSchema
>;
export type RiskEventScoreFinalExpression = z.infer<
  typeof RiskEventScoreFinalExpressionSchema
>;
export type RiskEventScoringConfiguration = z.infer<
  typeof RiskEventScoringConfigurationSchema
>;
export type RiskEventScoreStatus = z.infer<typeof RiskEventScoreStatusSchema>;
