import { z } from "zod";

const MAX_EXPRESSION_DEPTH = 6;
const SafeNumberSchema = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const ScoreSchema = SafeNumberSchema.min(0).max(100);
const ExpressionLiteralSchema = z
  .object({ op: z.literal("literal"), value: SafeNumberSchema })
  .strict();
const FieldValueSchema = z.union([
  z.string().max(1_024),
  SafeNumberSchema,
  z.boolean(),
]);
export const ProfileFieldInputNameSchema = z.enum([
  "value",
  "width",
  "height",
  "maxTouchPoints",
  "touchEvent",
  "touchStart",
]);
export type ScoringFieldInputType =
  | "number"
  | "string"
  | "screen_resolution"
  | "touch_support"
  | "boolean_array";

const fieldLeafSchemas = [
  ExpressionLiteralSchema,
  z
    .object({
      op: z.literal("input"),
      name: ProfileFieldInputNameSchema,
    })
    .strict(),
  z.object({ op: z.literal("count") }).strict(),
  z.object({ op: z.literal("true_count") }).strict(),
  z.object({ op: z.literal("true_ratio") }).strict(),
  z
    .object({
      op: z.literal("compare"),
      input: ProfileFieldInputNameSchema,
      comparison: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
      expected: FieldValueSchema,
      whenTrue: SafeNumberSchema,
      whenFalse: SafeNumberSchema,
    })
    .strict(),
] as const;

function buildFieldExpressionSchema(depth: number): z.ZodType {
  if (depth === 0) return z.union(fieldLeafSchemas);
  const child = buildFieldExpressionSchema(depth - 1);
  return z.union([
    ...fieldLeafSchemas,
    z
      .object({
        op: z.enum(["add", "subtract", "multiply", "divide", "min", "max"]),
        left: child,
        right: child,
      })
      .strict(),
    z
      .object({
        op: z.enum(["abs", "negate"]),
        value: child,
      })
      .strict(),
  ]);
}

export const ProfileFieldScoreExpressionSchema = buildFieldExpressionSchema(
  MAX_EXPRESSION_DEPTH,
);

export const profileScoreableFields = [
  { field: "osCpu", inputType: "string" },
  { field: "screenResolution", inputType: "screen_resolution" },
  { field: "platform", inputType: "string" },
  { field: "touchSupport", inputType: "touch_support" },
  { field: "vendor", inputType: "string" },
  { field: "architecture", inputType: "number" },
  { field: "applePay", inputType: "number" },
  { field: "currentIp.asnScore", inputType: "number" },
  { field: "recentIpHistory.count", inputType: "number" },
  { field: "recentIpHistory.asnAverage", inputType: "number" },
  { field: "recentIpHistory.blacklisted", inputType: "boolean_array" },
  { field: "currentIpReuse.global.distinctProfiles1d", inputType: "number" },
  { field: "currentIpReuse.global.distinctProfiles7d", inputType: "number" },
  { field: "currentIpReuse.global.distinctProfiles30d", inputType: "number" },
  { field: "currentIpReuse.site.distinctProfiles1d", inputType: "number" },
  { field: "currentIpReuse.site.distinctProfiles7d", inputType: "number" },
  { field: "currentIpReuse.site.distinctProfiles30d", inputType: "number" },
] as const;

export const ProfileScoreableFieldSchema = z.enum(
  profileScoreableFields.map(({ field }) => field) as [
    (typeof profileScoreableFields)[number]["field"],
    ...(typeof profileScoreableFields)[number]["field"][],
  ],
);
export const ProfileScoreableFieldRegistrySchema = z
  .array(
    z
      .object({
        field: ProfileScoreableFieldSchema,
        inputType: z.enum([
          "number",
          "string",
          "screen_resolution",
          "touch_support",
          "boolean_array",
        ]),
      })
      .strict(),
  )
  .length(profileScoreableFields.length);

const finalVariables = [
  "weightedSum",
  "presentWeightSum",
  "presentFieldCount",
] as const;
export const ProfileScoreFinalVariableSchema = z.enum(finalVariables);

function buildFinalExpressionSchema(depth: number): z.ZodType {
  const leaves = [
    ExpressionLiteralSchema,
    z
      .object({
        op: z.literal("variable"),
        name: ProfileScoreFinalVariableSchema,
      })
      .strict(),
  ] as const;
  if (depth === 0) return z.union(leaves);
  const child = buildFinalExpressionSchema(depth - 1);
  return z.union([
    ...leaves,
    z
      .object({
        op: z.enum(["add", "subtract", "multiply", "divide", "min", "max"]),
        left: child,
        right: child,
      })
      .strict(),
    z
      .object({
        op: z.enum(["abs", "negate"]),
        value: child,
      })
      .strict(),
  ]);
}

export const ProfileScoreFinalExpressionSchema = buildFinalExpressionSchema(
  MAX_EXPRESSION_DEPTH,
);

export const ProfileScoringFieldConfigurationSchema = z
  .object({
    field: ProfileScoreableFieldSchema,
    enabled: z.boolean(),
    expression: ProfileFieldScoreExpressionSchema,
    weight: SafeNumberSchema.nonnegative(),
  })
  .strict();

const fieldInputTypes = new Map(
  profileScoreableFields.map(({ field, inputType }) => [field, inputType]),
);

export const ProfileScoringConfigurationSchema = z
  .object({
    fields: z
      .array(ProfileScoringFieldConfigurationSchema)
      .max(profileScoreableFields.length),
    finalExpression: ProfileScoreFinalExpressionSchema,
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
      const inputType = fieldInputTypes.get(field.field);
      const invalidOperator = findInvalidScoringFieldOperator(
        field.expression,
        inputType!,
      );
      if (invalidOperator) {
        context.addIssue({
          code: "custom",
          message: `${invalidOperator} is not supported for ${inputType}`,
          path: ["fields", index, "expression"],
        });
      }
    }
  });

export const ProfileScoreStatusSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      score: ScoreSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "scoring_unconfigured",
        "no_usable_fields",
        "invalid_final_calculation",
      ]),
    })
    .strict(),
]);

export const OperatorProfileScoringConfigurationMutationSchema = z
  .object({ configuration: ProfileScoringConfigurationSchema })
  .strict();
const ConfiguredProfileScoringResponseSchema = z
  .object({
    status: z.literal("configured"),
    registry: ProfileScoreableFieldRegistrySchema,
    configuration: ProfileScoringConfigurationSchema,
    updatedBy: z.string().min(16).max(128),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const OperatorProfileScoringConfigurationResponseSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("unconfigured"),
        registry: ProfileScoreableFieldRegistrySchema,
      })
      .strict(),
    ConfiguredProfileScoringResponseSchema,
  ]);
export const OperatorProfileScoringConfigurationMutationResponseSchema =
  ConfiguredProfileScoringResponseSchema;

export function findInvalidScoringFieldOperator(
  expression: unknown,
  inputType: ScoringFieldInputType,
): string | undefined {
  const node = expression as {
    op: string;
    left?: unknown;
    right?: unknown;
    value?: unknown;
    name?: string;
    input?: string;
    comparison?: string;
    expected?: unknown;
  };
  if (["add", "subtract", "multiply", "divide", "min", "max"].includes(node.op)) {
    return findInvalidScoringFieldOperator(node.left, inputType) ??
      findInvalidScoringFieldOperator(node.right, inputType);
  }
  if (node.op === "abs" || node.op === "negate") {
    return findInvalidScoringFieldOperator(node.value, inputType);
  }
  if (node.op === "input") {
    return fieldInputType(inputType, node.name) === "number"
      ? undefined
      : node.op;
  }
  if (
    ["count", "true_count", "true_ratio"].includes(node.op) &&
    inputType !== "boolean_array"
  ) {
    return node.op;
  }
  if (node.op === "compare") {
    const comparedType = fieldInputType(inputType, node.input);
    if (
      !comparedType ||
      typeof node.expected !== comparedType ||
      (comparedType !== "number" &&
        !["eq", "neq"].includes(node.comparison ?? ""))
    ) {
      return node.op;
    }
  }
  return undefined;
}

function fieldInputType(
  inputType: ScoringFieldInputType,
  inputName: string | undefined,
): "number" | "string" | "boolean" | undefined {
  if (inputName === "value") {
    return inputType === "number" || inputType === "string"
      ? inputType
      : undefined;
  }
  if (
    inputType === "screen_resolution" &&
    (inputName === "width" || inputName === "height")
  ) {
    return "number";
  }
  if (inputType === "touch_support") {
    if (inputName === "maxTouchPoints") return "number";
    if (inputName === "touchEvent" || inputName === "touchStart") {
      return "boolean";
    }
  }
  return undefined;
}

export type ProfileScoreableField = z.infer<
  typeof ProfileScoreableFieldSchema
>;
export type ProfileFieldScoreExpression = z.infer<
  typeof ProfileFieldScoreExpressionSchema
>;
export type ProfileScoreFinalExpression = z.infer<
  typeof ProfileScoreFinalExpressionSchema
>;
export type ProfileScoringConfiguration = z.infer<
  typeof ProfileScoringConfigurationSchema
>;
export type ProfileScoreStatus = z.infer<typeof ProfileScoreStatusSchema>;
