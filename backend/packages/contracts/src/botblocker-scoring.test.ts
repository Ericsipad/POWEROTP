import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OperatorProfileScoringConfigurationResponseSchema,
  ProfileScoreStatusSchema,
  ProfileScoringConfigurationSchema,
  profileScoreableFields,
} from "./botblocker-scoring.js";

const validConfiguration = {
  fields: [{
    field: "currentIp.asnScore",
    enabled: true,
    expression: { op: "input", name: "value" },
    weight: 2,
  }],
  finalExpression: {
    op: "divide",
    left: { op: "variable", name: "weightedSum" },
    right: { op: "variable", name: "presentWeightSum" },
  },
} as const;

describe("ProfileScoringConfigurationSchema", () => {
  it("accepts only approved fields and bounded typed math", () => {
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse(validConfiguration).success,
      true,
    );
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [
          {
            field: "screenResolution",
            enabled: true,
            expression: { op: "input", name: "width" },
            weight: 1,
          },
          {
            field: "touchSupport",
            enabled: true,
            expression: {
              op: "compare",
              input: "touchEvent",
              comparison: "eq",
              expected: true,
              whenTrue: 100,
              whenFalse: 0,
            },
            weight: 1,
          },
        ],
      }).success,
      true,
    );
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [{
          ...validConfiguration.fields[0],
          field: "latestEvidence.webdriver",
        }],
      }).success,
      false,
    );
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [{
          field: "platform",
          enabled: true,
          expression: { op: "input", name: "value" },
          weight: 1,
        }],
      }).success,
      false,
    );
  });

  it("rejects duplicate fields and negative or non-finite weights", () => {
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [
          validConfiguration.fields[0],
          validConfiguration.fields[0],
        ],
      }).success,
      false,
    );
    for (const weight of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        ProfileScoringConfigurationSchema.safeParse({
          ...validConfiguration,
          fields: [{ ...validConfiguration.fields[0], weight }],
        }).success,
        false,
      );
    }
  });

  it("rejects executable, dynamic, unsupported, and over-deep expressions", () => {
    const invalidExpressions = [
      { op: "eval", source: "process.exit()" },
      { op: "property", key: "constructor" },
      { op: "average" },
      { op: "compare", comparison: "contains", expected: "Win" },
    ];
    for (const expression of invalidExpressions) {
      assert.equal(
        ProfileScoringConfigurationSchema.safeParse({
          ...validConfiguration,
          fields: [{ ...validConfiguration.fields[0], expression }],
        }).success,
        false,
      );
    }

    let expression: unknown = { op: "input", name: "value" };
    for (let depth = 0; depth < 8; depth += 1) {
      expression = { op: "abs", value: expression };
    }
    assert.equal(
      ProfileScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [{ ...validConfiguration.fields[0], expression }],
      }).success,
      false,
    );
  });
});

describe("profile scoring status and unconfigured response", () => {
  it("contains the fixed registry without seeded scoring defaults", () => {
    const response = OperatorProfileScoringConfigurationResponseSchema.parse({
      status: "unconfigured",
      registry: profileScoreableFields,
    });
    assert.equal(response.status, "unconfigured");
    assert.equal(response.registry.length, 18);
    assert.deepEqual(
      response.registry.find((entry) => entry.field === "risk_events_sum"),
      { field: "risk_events_sum", inputType: "number" },
    );
    assert.equal("configuration" in response, false);
    assert.equal(
      JSON.stringify(response).includes("threshold"),
      false,
    );
  });

  it("accepts only finite 0..100 available scores", () => {
    for (const score of [0, 50.5, 100]) {
      assert.equal(
        ProfileScoreStatusSchema.safeParse({ status: "available", score })
          .success,
        true,
      );
    }
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        ProfileScoreStatusSchema.safeParse({ status: "available", score })
          .success,
        false,
      );
    }
  });
});
