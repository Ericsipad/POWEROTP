import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProfileScoringConfigurationSchema,
  type ProfileScoreStatus,
  type ProfileScoringConfiguration,
} from "@powerotp/contracts";

import type {
  BotBlockerScope,
  UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";
import type {
  ProfileScoringConfigurationDocument,
} from "./botblocker-profile-scoring-persistence.js";
import {
  BotBlockerProfileScoringService,
  calculateProfileScore,
} from "./botblocker-profile-scoring.js";

const scope: BotBlockerScope = {
  customerId: "usr_owner_123456789",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const now = new Date("2026-08-18T12:00:00.000Z");

function profile(
  overrides: Partial<UserIntelligenceDocument> = {},
): UserIntelligenceDocument {
  return {
    _id: "bui_profile_123456789",
    ...scope,
    recentIpHistory: [],
    gateSessionCount: 1,
    behaviorReportCount: 0,
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: new Date("2028-02-17T12:00:00.000Z"),
    ...overrides,
  };
}

const weightedAverage = {
  op: "divide",
  left: { op: "variable", name: "weightedSum" },
  right: { op: "variable", name: "presentWeightSum" },
} as const;

function configuration(
  fields: unknown[],
  finalExpression: unknown = weightedAverage,
): ProfileScoringConfiguration {
  return ProfileScoringConfigurationSchema.parse({
    fields,
    finalExpression,
  });
}

function stored(
  configurationValue: ProfileScoringConfiguration,
): ProfileScoringConfigurationDocument {
  return {
    _id: "active",
    configuration: configurationValue,
    updatedBy: "usr_admin_123456789",
    updatedAt: now,
  };
}

const numericField = (
  field: "applePay" | "currentIp.asnScore" | "recentIpHistory.count",
  expression: unknown = { op: "input", name: "value" },
  options: { enabled?: boolean; weight?: number } = {},
) => ({
  field,
  enabled: options.enabled ?? true,
  expression,
  weight: options.weight ?? 1,
});

describe("calculateProfileScore", () => {
  it("returns typed unavailable when scoring is unconfigured", () => {
    assert.deepEqual(calculateProfileScore(profile(), null), {
      status: "unavailable",
      reason: "scoring_unconfigured",
    });
  });

  it("produces a finite weighted 0..100 score", () => {
    const result = calculateProfileScore(
      profile({
        applePay: 80,
        currentIp: { ip: "203.0.113.5", asnScore: 20, blacklisted: false },
      }),
      stored(configuration([
        numericField("applePay", { op: "input", name: "value" }, { weight: 3 }),
        numericField("currentIp.asnScore"),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 65 });
  });

  it("uses only fixed sub-bindings for composite direct fields", () => {
    const result = calculateProfileScore(
      profile({
        screenResolution: { width: 80, height: 60 },
        touchSupport: {
          maxTouchPoints: 5,
          touchEvent: true,
          touchStart: false,
        },
      }),
      stored(configuration([
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
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 90 });
  });

  it("excludes missing fields from numerator and denominator", () => {
    const result = calculateProfileScore(
      profile({ applePay: 80 }),
      stored(configuration([
        numericField("applePay", { op: "input", name: "value" }, { weight: 3 }),
        numericField(
          "currentIp.asnScore",
          { op: "input", name: "value" },
          { weight: 99 },
        ),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 80 });
  });

  it("lets one usable field score when another expression is unusable", () => {
    const result = calculateProfileScore(
      profile({ applePay: 60 }),
      stored(configuration([
        numericField("applePay"),
        numericField("recentIpHistory.count", {
          op: "divide",
          left: { op: "input", name: "value" },
          right: { op: "literal", value: 0 },
        }),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 60 });
  });

  it("returns unavailable when no enabled input is usable", () => {
    assert.deepEqual(
      calculateProfileScore(
        profile(),
        stored(configuration([numericField("currentIp.asnScore")])),
      ),
      { status: "unavailable", reason: "no_usable_fields" },
    );
  });

  it("does not include disabled fields", () => {
    const result = calculateProfileScore(
      profile({ applePay: 90 }),
      stored(configuration([
        numericField(
          "applePay",
          { op: "input", name: "value" },
          { enabled: false },
        ),
        numericField("recentIpHistory.count", {
          op: "literal",
          value: 25,
        }),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 25 });
  });

  it("treats empty history count as zero but its ratio as unavailable", () => {
    const result = calculateProfileScore(
      profile(),
      stored(configuration([
        numericField("recentIpHistory.count"),
        {
          field: "recentIpHistory.blacklisted",
          enabled: true,
          expression: { op: "true_ratio" },
          weight: 100,
        },
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 0 });
  });

  it("excludes out-of-range per-field results", () => {
    const result = calculateProfileScore(
      profile({ applePay: 20 }),
      stored(configuration([
        numericField("applePay", { op: "literal", value: 101 }),
        numericField("recentIpHistory.count", { op: "literal", value: 40 }),
      ])),
    );
    assert.deepEqual(result, { status: "available", score: 40 });
  });

  it("returns unavailable for division by zero or an out-of-range final result", () => {
    const configured = stored(configuration([
      numericField("recentIpHistory.count", { op: "literal", value: 40 }),
    ]));
    assert.deepEqual(
      calculateProfileScore(
        profile(),
        {
          ...configured,
          configuration: configuration(
            configured.configuration.fields,
            {
              op: "divide",
              left: { op: "variable", name: "weightedSum" },
              right: { op: "literal", value: 0 },
            },
          ),
        },
      ),
      { status: "unavailable", reason: "invalid_final_calculation" },
    );
    assert.deepEqual(
      calculateProfileScore(
        profile(),
        stored(configuration(
          configured.configuration.fields,
          { op: "literal", value: 101 },
        )),
      ),
      { status: "unavailable", reason: "invalid_final_calculation" },
    );
  });
});

describe("BotBlockerProfileScoringService", () => {
  it("replaces one current score using a committed profile snapshot", async () => {
    const row = profile({ applePay: 70 });
    const writes: ProfileScoreStatus[] = [];
    const service = new BotBlockerProfileScoringService(
      {
        getConfiguration: async () =>
          stored(configuration([numericField("applePay")])),
      },
      {
        findUserIntelligence: async () => structuredClone(row),
        replaceCurrentScore: async (
          candidateScope,
          id,
          profileUpdatedAt,
          score,
        ) => {
          assert.deepEqual(candidateScope, scope);
          assert.equal(id, row._id);
          assert.equal(profileUpdatedAt.getTime(), row.updatedAt.getTime());
          writes.splice(0, writes.length, score);
          return true;
        },
      },
    );

    assert.deepEqual(await service.recalculate(scope, row._id), {
      status: "available",
      score: 70,
    });
    row.applePay = 30;
    assert.deepEqual(await service.recalculate(scope, row._id), {
      status: "available",
      score: 30,
    });
    assert.deepEqual(writes, [{ status: "available", score: 30 }]);
  });

  it("does not overwrite when the profile changed after the committed read", async () => {
    const row = profile({ applePay: 70 });
    const service = new BotBlockerProfileScoringService(
      {
        getConfiguration: async () =>
          stored(configuration([numericField("applePay")])),
      },
      {
        findUserIntelligence: async () => row,
        replaceCurrentScore: async () => false,
      },
    );
    assert.equal(await service.recalculate(scope, row._id), undefined);
  });
});
