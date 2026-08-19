import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OperatorRiskEventScoringConfigurationResponseSchema,
  RiskEventScoreStatusSchema,
  RiskEventScoringConfigurationSchema,
  riskEventScoreableFields,
} from "./botblocker-risk-event-scoring.js";

const validConfiguration = {
  fields: [{
    field: "request.method",
    enabled: true,
    expression: {
      op: "compare",
      input: "value",
      comparison: "eq",
      expected: "POST",
      whenTrue: 75,
      whenFalse: 25,
    },
    weight: 2,
  }],
  finalExpression: {
    op: "divide",
    left: { op: "variable", name: "weightedSum" },
    right: { op: "variable", name: "presentWeightSum" },
  },
} as const;

describe("RiskEventScoringConfigurationSchema", () => {
  it("exposes only the approved closed V1 registry", () => {
    assert.equal(riskEventScoreableFields.length, 29);
    assert.deepEqual(riskEventScoreableFields[0], {
      field: "request.method",
      inputType: "string",
    });
    assert.equal(
      riskEventScoreableFields.some(({ field }) =>
        field.includes("path") || field.includes("fingerprint")
      ),
      false,
    );
    assert.equal(
      RiskEventScoringConfigurationSchema.safeParse(validConfiguration).success,
      true,
    );
    assert.equal(
      RiskEventScoringConfigurationSchema.safeParse({
        ...validConfiguration,
        fields: [{
          ...validConfiguration.fields[0],
          field: "report.payload.request.path",
        }],
      }).success,
      false,
    );
  });

  it("rejects incompatible, duplicate, executable, and unsafe configuration", () => {
    const invalidFields = [
      [{
        field: "request.method",
        enabled: true,
        expression: { op: "input", name: "value" },
        weight: 1,
      }],
      [validConfiguration.fields[0], validConfiguration.fields[0]],
      [{
        field: "clicks.totalCount",
        enabled: true,
        expression: { op: "eval", source: "process.exit()" },
        weight: 1,
      }],
      [{
        field: "clicks.totalCount",
        enabled: true,
        expression: { op: "input", name: "value" },
        weight: -1,
      }],
    ];
    for (const fields of invalidFields) {
      assert.equal(
        RiskEventScoringConfigurationSchema.safeParse({
          ...validConfiguration,
          fields,
        }).success,
        false,
      );
    }
  });
});

describe("risk-event score status and unconfigured response", () => {
  it("returns the registry without seeded formulas or defaults", () => {
    const response =
      OperatorRiskEventScoringConfigurationResponseSchema.parse({
        status: "unconfigured",
        registry: riskEventScoreableFields,
      });
    assert.equal(response.status, "unconfigured");
    assert.equal("configuration" in response, false);
  });

  it("accepts only typed unavailable or finite 0..100 scores", () => {
    assert.equal(
      RiskEventScoreStatusSchema.safeParse({
        status: "unavailable",
        reason: "scoring_unconfigured",
      }).success,
      true,
    );
    for (const score of [0, 50.5, 100]) {
      assert.equal(
        RiskEventScoreStatusSchema.safeParse({ status: "available", score })
          .success,
        true,
      );
    }
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        RiskEventScoreStatusSchema.safeParse({ status: "available", score })
          .success,
        false,
      );
    }
  });
});
