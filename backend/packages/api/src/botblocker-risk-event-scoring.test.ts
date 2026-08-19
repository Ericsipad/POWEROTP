import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RiskEventScoringConfigurationSchema,
  riskEventScoreableFields,
  type CanonicalReportRequest,
  type RiskEventScoringConfiguration,
} from "@powerotp/contracts";

import type {
  RiskEventScoringConfigurationDocument,
} from "./botblocker-risk-event-scoring-persistence.js";
import {
  calculateRiskEventScore,
} from "./botblocker-risk-event-scoring.js";

const now = new Date("2026-08-19T08:00:00.000Z");

function report(
  payload: CanonicalReportRequest["payload"] = {},
): CanonicalReportRequest {
  return {
    protocolVersion: 1,
    siteId: "bbs_owner_123456789",
    gateSessionId: "bgs_session_123456789",
    audience: "https://customer.example",
    reportSequence: -1,
    nonce: "risk_event_score_nonce_123456",
    issuedAt: now.getTime(),
    payload,
  };
}

function richReport(): CanonicalReportRequest {
  return report({
    request: {
      siteId: "bbs_owner_123456789",
      method: "POST",
      path: "/checkout",
    },
    browserEvidence: {
      routePath: "/checkout",
      clicks: [
        { category: "button" },
        { category: "button" },
        { category: "link" },
      ],
      mouseDirectness: { averageDirectnessRatio: 0.75, sampleCount: 4 },
      scroll: { smoothnessScore: 0.8, highSpeedEventCount: 2 },
      honeypotActivations: [{ honeypotId: "decoy" }],
      environment: {
        evidenceVersion: 1,
        sensorVersion: "1.0.0",
        automationIndicators: ["webdriver", "untrusted_click"],
      },
      pageView: {
        durationMs: 30,
        activeDurationMs: 20,
        documentWidth: 80,
        documentHeight: 90,
        pointerHeatmap: {
          gridSize: 32,
          bins: [
            { column: 0, row: 0, sampleCount: 10, dwellMs: 15 },
            { column: 1, row: 1, sampleCount: 20, dwellMs: 25 },
          ],
        },
      },
    },
    riskSignals: [
      { kind: "automation_indicator", occurredAt: now.getTime() },
      { kind: "automation_indicator", occurredAt: now.getTime() },
      { kind: "challenge_failure", occurredAt: now.getTime() },
    ],
  });
}

const weightedAverage = {
  op: "divide",
  left: { op: "variable", name: "weightedSum" },
  right: { op: "variable", name: "presentWeightSum" },
} as const;

function configuration(
  fields: unknown[],
  finalExpression: unknown = weightedAverage,
): RiskEventScoringConfiguration {
  return RiskEventScoringConfigurationSchema.parse({
    fields,
    finalExpression,
  });
}

function stored(
  configurationValue: RiskEventScoringConfiguration,
): RiskEventScoringConfigurationDocument {
  return {
    _id: "active",
    configuration: configurationValue,
    updatedBy: "usr_platform_admin",
    updatedAt: now,
  };
}

function numericField(
  field: (typeof riskEventScoreableFields)[number]["field"],
  expression: unknown = { op: "input", name: "value" },
  options: { enabled?: boolean; weight?: number } = {},
) {
  return {
    field,
    enabled: options.enabled ?? true,
    expression,
    weight: options.weight ?? 1,
  };
}

describe("calculateRiskEventScore", () => {
  it("returns typed unavailable when configuration is absent", () => {
    assert.deepEqual(calculateRiskEventScore(richReport(), null), {
      status: "unavailable",
      reason: "scoring_unconfigured",
    });
  });

  it("resolves every approved V1 field from present canonical row evidence", () => {
    for (const { field } of riskEventScoreableFields) {
      const expression = field === "request.method"
        ? {
          op: "compare",
          input: "value",
          comparison: "eq",
          expected: "POST",
          whenTrue: 50,
          whenFalse: 0,
        }
        : { op: "literal", value: 50 };
      assert.deepEqual(
        calculateRiskEventScore(
          richReport(),
          stored(configuration([numericField(field, expression)])),
        ),
        { status: "available", score: 50 },
        field,
      );
    }
  });

  it("derives bounded counts, presence values, and exact categorical matches", () => {
    const result = calculateRiskEventScore(
      richReport(),
      stored(configuration([
        numericField("clicks.button.count", undefined, { weight: 2 }),
        numericField("pageView.pointerHeatmap.totalSampleCount"),
        numericField("automationIndicators.webdriver.present"),
        numericField("riskSignals.challenge_failure.count"),
        {
          field: "request.method",
          enabled: true,
          expression: {
            op: "compare",
            input: "value",
            comparison: "eq",
            expected: "POST",
            whenTrue: 100,
            whenFalse: 0,
          },
          weight: 1,
        },
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 22.666666666666668 });
  });

  it("excludes missing, disabled, incompatible, and unusable fields independently", () => {
    const zeroSample = richReport();
    zeroSample.payload.browserEvidence!.mouseDirectness = {
      averageDirectnessRatio: 0,
      sampleCount: 0,
    };
    const result = calculateRiskEventScore(
      zeroSample,
      stored(configuration([
        numericField("mouseDirectness.averageDirectnessRatio"),
        numericField("pageView.durationMs", { op: "literal", value: 101 }),
        numericField(
          "riskSignals.challenge_failure.count",
          { op: "literal", value: 20 },
          { enabled: false },
        ),
        numericField("clicks.totalCount", { op: "literal", value: 40 }),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 40 });
  });

  it("does not fabricate zero when the evidence category is absent", () => {
    assert.deepEqual(
      calculateRiskEventScore(
        report(),
        stored(configuration([
          numericField("clicks.totalCount"),
          numericField("riskSignals.challenge_failure.count"),
        ])),
      ),
      { status: "unavailable", reason: "no_usable_fields" },
    );
  });

  it("returns unavailable for a non-finite or out-of-range final result", () => {
    assert.deepEqual(
      calculateRiskEventScore(
        richReport(),
        stored(configuration(
          [numericField("clicks.totalCount")],
          {
            op: "divide",
            left: { op: "variable", name: "weightedSum" },
            right: { op: "literal", value: 0 },
          },
        )),
      ),
      { status: "unavailable", reason: "invalid_final_calculation" },
    );
  });
});
