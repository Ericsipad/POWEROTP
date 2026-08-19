import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RiskEventScoringConfigurationSchema } from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  BotBlockerRiskEventScoringPersistence,
  type RiskEventScoringConfigurationDocument,
} from "./botblocker-risk-event-scoring-persistence.js";

function fixture() {
  let row: RiskEventScoringConfigurationDocument | null = null;
  const collection = {
    findOne: async () => row,
    findOneAndUpdate: async (
      filter: { _id: "active" },
      update: { $set: Omit<RiskEventScoringConfigurationDocument, "_id"> },
    ) => {
      row = { _id: filter._id, ...update.$set };
      return row;
    },
  };
  return {
    persistence: new BotBlockerRiskEventScoringPersistence({
      collection: () => collection,
    } as unknown as Db),
    get row() {
      return row;
    },
  };
}

const configuration = RiskEventScoringConfigurationSchema.parse({
  fields: [{
    field: "clicks.totalCount",
    enabled: true,
    expression: { op: "input", name: "value" },
    weight: 1,
  }],
  finalExpression: {
    op: "divide",
    left: { op: "variable", name: "weightedSum" },
    right: { op: "variable", name: "presentWeightSum" },
  },
});

describe("BotBlockerRiskEventScoringPersistence", () => {
  it("starts unconfigured and replaces only the current configuration", async () => {
    const state = fixture();
    assert.equal(await state.persistence.getConfiguration(), null);

    const first = await state.persistence.replaceConfiguration({
      configuration,
      updatedBy: "usr_admin_123456789",
      now: new Date("2026-08-19T08:00:00.000Z"),
    });
    const replacement = await state.persistence.replaceConfiguration({
      configuration: {
        ...configuration,
        fields: [{ ...configuration.fields[0]!, enabled: false }],
      },
      updatedBy: "usr_admin_987654321",
      now: new Date("2026-08-19T09:00:00.000Z"),
    });

    assert.equal(first._id, "active");
    assert.equal(replacement._id, "active");
    assert.equal(replacement.configuration.fields[0]!.enabled, false);
    assert.equal(state.row?.updatedBy, "usr_admin_987654321");
  });
});
