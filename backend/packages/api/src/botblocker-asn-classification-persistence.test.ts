import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  BotBlockerAsnClassificationPersistence,
  ensureBotBlockerAsnClassificationIndexes,
  toAsnClassificationResponse,
  type AsnClassificationDocument,
} from "./botblocker-asn-classification-persistence.js";

interface CapturedIndex {
  keys: Record<string, number>;
}

function fakeDb() {
  const rows: AsnClassificationDocument[] = [];
  const indexes: CapturedIndex[] = [];

  function collection() {
    return {
      createIndex: async (keys: Record<string, number>) => {
        indexes.push({ keys });
        return "index";
      },
      findOneAndUpdate: async (
        filter: { _id: number },
        update: {
          $set?: Partial<AsnClassificationDocument>;
          $unset?: Record<string, "">;
          $setOnInsert?: Partial<AsnClassificationDocument>;
        },
        options?: { upsert?: boolean },
      ) => {
        let row = rows.find((candidate) => candidate._id === filter._id);
        if (!row) {
          if (!options?.upsert) return null;
          row = { _id: filter._id, ...update.$setOnInsert } as AsnClassificationDocument;
          rows.push(row);
        }
        if (update.$set) Object.assign(row, update.$set);
        if (update.$unset) {
          for (const key of Object.keys(update.$unset)) {
            delete (row as unknown as Record<string, unknown>)[key];
          }
        }
        return row;
      },
      find: (filter: { asnType?: string; updatedAt?: { $lt: Date } }) => {
        const matching = rows.filter(
          (row) =>
            (!filter.asnType || row.asnType === filter.asnType) &&
            (!filter.updatedAt || row.updatedAt < filter.updatedAt.$lt),
        );
        return {
          sort: () => ({
            limit: (n: number) => ({
              toArray: async () =>
                [...matching]
                  .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                  .slice(0, n),
            }),
          }),
        };
      },
    };
  }

  const db = { collection: () => collection() } as unknown as Db;
  return { db, rows, indexes };
}

const now = new Date("2026-08-17T00:00:00.000Z");
const later = new Date("2026-08-17T01:00:00.000Z");

describe("ensureBotBlockerAsnClassificationIndexes", () => {
  it("creates the asnType/updatedAt index", async () => {
    const { db, indexes } = fakeDb();
    await ensureBotBlockerAsnClassificationIndexes(db);
    assert.ok(indexes.some((index) => index.keys.asnType === 1 && index.keys.updatedAt === -1));
  });
});

describe("BotBlockerAsnClassificationPersistence", () => {
  it("creates a classification row keyed by the ASN number", async () => {
    const { db, rows } = fakeDb();
    const persistence = new BotBlockerAsnClassificationPersistence(db);

    const entry = await persistence.upsertClassification({
      asn: 64500,
      asnType: "unclassified",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin",
      now,
    });

    assert.equal(entry._id, 64500);
    assert.equal(entry.asnType, "unclassified");
    assert.equal(rows.length, 1);
  });

  it("overwrites an existing row for the same ASN instead of duplicating it", async () => {
    const { db, rows } = fakeDb();
    const persistence = new BotBlockerAsnClassificationPersistence(db);

    await persistence.upsertClassification({
      asn: 64500,
      asnType: "unclassified",
      classificationSource: "manual",
      asnOrg: "Initial Org",
      updatedBy: "usr_platform_admin",
      now,
    });
    const updated = await persistence.upsertClassification({
      asn: 64500,
      asnType: "datacenter",
      classificationSource: "ai_research",
      updatedBy: "usr_platform_admin",
      now: later,
    });

    assert.equal(rows.length, 1);
    assert.equal(updated.asnType, "datacenter");
    assert.equal(updated.classificationSource, "ai_research");
    assert.equal(updated.asnOrg, undefined);
  });

  it("lists classifications filtered by asnType, most recently updated first", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerAsnClassificationPersistence(db);
    await persistence.upsertClassification({
      asn: 64500,
      asnType: "datacenter",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin",
      now,
    });
    await persistence.upsertClassification({
      asn: 64501,
      asnType: "unclassified",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin",
      now: later,
    });
    await persistence.upsertClassification({
      asn: 64502,
      asnType: "datacenter",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin",
      now: later,
    });

    const datacenterOnly = await persistence.listClassifications({
      asnType: "datacenter",
      limit: 50,
    });
    assert.deepEqual(
      datacenterOnly.map((entry) => entry._id),
      [64502, 64500],
    );

    const all = await persistence.listClassifications({ limit: 50 });
    assert.equal(all.length, 3);
  });
});

describe("toAsnClassificationResponse", () => {
  it("maps optional asnOrg/notes only when present", () => {
    const entry: AsnClassificationDocument = {
      _id: 64500,
      asnType: "unclassified",
      classificationSource: "manual",
      updatedBy: "usr_platform_admin",
      createdAt: now,
      updatedAt: now,
    };

    const withoutOptional = toAsnClassificationResponse(entry);
    assert.equal("asnOrg" in withoutOptional, false);
    assert.equal("notes" in withoutOptional, false);
    assert.equal(withoutOptional.asn, 64500);

    const withOptional = toAsnClassificationResponse({
      ...entry,
      asnOrg: "Example Org",
      notes: "Researched via WHOIS",
    });
    assert.equal(withOptional.asnOrg, "Example Org");
    assert.equal(withOptional.notes, "Researched via WHOIS");
  });
});
