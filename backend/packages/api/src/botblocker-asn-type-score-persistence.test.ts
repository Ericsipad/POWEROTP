import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asnTypes } from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  BotBlockerAsnTypeScorePersistence,
  ensureBotBlockerAsnTypeScoreIndexes,
  toAsnTypeScoreResponse,
  type AsnTypeScoreDocument,
} from "./botblocker-asn-type-score-persistence.js";

function fakeDb() {
  const rows: AsnTypeScoreDocument[] = [];

  function collection() {
    return {
      findOneAndUpdate: async (
        filter: { _id: string },
        update: { $set: Partial<AsnTypeScoreDocument> },
        options?: { upsert?: boolean },
      ) => {
        let row = rows.find((candidate) => candidate._id === filter._id);
        if (!row) {
          if (!options?.upsert) return null;
          row = { _id: filter._id } as AsnTypeScoreDocument;
          rows.push(row);
        }
        Object.assign(row, update.$set);
        return row;
      },
      find: () => ({
        toArray: async () => [...rows],
      }),
    };
  }

  const db = { collection: () => collection() } as unknown as Db;
  return { db, rows };
}

const now = new Date("2026-08-17T00:00:00.000Z");

describe("ensureBotBlockerAsnTypeScoreIndexes", () => {
  it("is a no-op that resolves without error", async () => {
    const { db } = fakeDb();
    await assert.doesNotReject(ensureBotBlockerAsnTypeScoreIndexes(db));
  });
});

describe("BotBlockerAsnTypeScorePersistence", () => {
  it("upserts a score for a type", async () => {
    const { db, rows } = fakeDb();
    const persistence = new BotBlockerAsnTypeScorePersistence(db);

    const entry = await persistence.upsertScore({
      asnType: "datacenter",
      score: 40,
      requiresApiLookup: true,
      updatedBy: "usr_platform_admin",
      now,
    });

    assert.equal(entry._id, "datacenter");
    assert.equal(entry.score, 40);
    assert.equal(entry.requiresApiLookup, true);
    assert.equal(rows.length, 1);
  });

  it("overwrites an existing score for the same type instead of duplicating it", async () => {
    const { db, rows } = fakeDb();
    const persistence = new BotBlockerAsnTypeScorePersistence(db);

    await persistence.upsertScore({
      asnType: "known_proxy",
      score: 10,
      requiresApiLookup: false,
      updatedBy: "usr_platform_admin",
      now,
    });
    const updated = await persistence.upsertScore({
      asnType: "known_proxy",
      score: 90,
      requiresApiLookup: true,
      updatedBy: "usr_platform_admin",
      now,
    });

    assert.equal(rows.length, 1);
    assert.equal(updated.score, 90);
    assert.equal(updated.requiresApiLookup, true);
  });

  it("lists exactly one entry per ASN type, synthesizing defaults for unconfigured types", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerAsnTypeScorePersistence(db);
    await persistence.upsertScore({
      asnType: "datacenter",
      score: 40,
      requiresApiLookup: true,
      updatedBy: "usr_platform_admin",
      now,
    });

    const all = await persistence.listAllScores();
    assert.equal(all.length, asnTypes.length);

    const datacenter = all.find((entry) => entry.document._id === "datacenter")!;
    assert.equal(datacenter.persisted, true);
    assert.equal(datacenter.document.score, 40);

    const unclassified = all.find((entry) => entry.document._id === "unclassified")!;
    assert.equal(unclassified.persisted, false);
    assert.equal(unclassified.document.score, 0);
    assert.equal(unclassified.document.requiresApiLookup, false);
  });
});

describe("toAsnTypeScoreResponse", () => {
  it("omits updatedBy/updatedAt for an unpersisted default", () => {
    const response = toAsnTypeScoreResponse(
      { _id: "unclassified", score: 0, requiresApiLookup: false, updatedAt: now, updatedBy: "" },
      false,
    );
    assert.equal("updatedBy" in response, false);
    assert.equal("updatedAt" in response, false);
  });

  it("includes updatedBy/updatedAt for a persisted entry", () => {
    const response = toAsnTypeScoreResponse(
      {
        _id: "datacenter",
        score: 40,
        requiresApiLookup: true,
        updatedAt: now,
        updatedBy: "usr_platform_admin",
      },
      true,
    );
    assert.equal(response.updatedBy, "usr_platform_admin");
    assert.equal(response.updatedAt, now.toISOString());
  });
});
