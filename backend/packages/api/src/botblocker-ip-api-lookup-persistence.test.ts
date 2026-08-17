import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  BotBlockerIpApiLookupPersistence,
  ensureBotBlockerIpApiLookupIndexes,
  type IpApiLookupDocument,
} from "./botblocker-ip-api-lookup-persistence.js";

interface CapturedIndex {
  collection: string;
  keys: Record<string, number>;
  options?: Record<string, unknown>;
}

function fakeDb() {
  const store: Record<string, IpApiLookupDocument[]> = {
    botblockerIpApiLookupsV4: [],
    botblockerIpApiLookupsV6: [],
  };
  const indexes: CapturedIndex[] = [];

  function collectionFor(name: string) {
    const rows = store[name]!;
    return {
      createIndex: async (
        keys: Record<string, number>,
        options?: Record<string, unknown>,
      ) => {
        indexes.push({ collection: name, keys, options });
        return `${name}_index`;
      },
      findOne: async (filter: { ip?: string }) =>
        rows.find((row) => filter.ip === undefined || row.ip === filter.ip) ?? null,
      findOneAndUpdate: async (
        filter: { ip?: string },
        update: {
          $set?: Partial<IpApiLookupDocument>;
          $setOnInsert?: Partial<IpApiLookupDocument>;
        },
        options?: { upsert?: boolean },
      ) => {
        let row = rows.find((candidate) => filter.ip === undefined || candidate.ip === filter.ip);
        if (!row) {
          if (!options?.upsert) return null;
          row = { ...update.$setOnInsert } as IpApiLookupDocument;
          rows.push(row);
        }
        if (update.$set) Object.assign(row, update.$set);
        return row;
      },
    };
  }

  const db = { collection: (name: string) => collectionFor(name) } as unknown as Db;
  return { db, store, indexes };
}

const now = new Date("2026-08-17T00:00:00.000Z");
const later = new Date("2026-08-18T00:00:00.000Z");

describe("ensureBotBlockerIpApiLookupIndexes", () => {
  it("creates a unique IP index and a TTL expiresAt index for both families", async () => {
    const { db, indexes } = fakeDb();
    await ensureBotBlockerIpApiLookupIndexes(db);

    for (const collection of ["botblockerIpApiLookupsV4", "botblockerIpApiLookupsV6"]) {
      assert.ok(
        indexes.some(
          (index) =>
            index.collection === collection &&
            index.keys.ip === 1 &&
            index.options?.unique === true,
        ),
      );
      assert.ok(
        indexes.some(
          (index) =>
            index.collection === collection &&
            index.keys.expiresAt === 1 &&
            index.options?.expireAfterSeconds === 0,
        ),
      );
    }
  });

  it("seeds exactly one placeholder row in the v4 collection, idempotently", async () => {
    const { db, store } = fakeDb();
    await ensureBotBlockerIpApiLookupIndexes(db);
    await ensureBotBlockerIpApiLookupIndexes(db);

    assert.equal(store.botblockerIpApiLookupsV4.length, 1);
    assert.equal(store.botblockerIpApiLookupsV6.length, 0);
    const placeholder = store.botblockerIpApiLookupsV4[0]!;
    assert.equal(placeholder.ip, "203.0.113.10");
    assert.equal(placeholder.vendor, "placeholder");
    assert.ok(placeholder.expiresAt.getTime() > placeholder.queriedAt.getTime());
  });
});

describe("BotBlockerIpApiLookupPersistence", () => {
  it("creates a v4 entry with a family-prefixed ID for a dotted-quad IP", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpApiLookupPersistence(db);

    const entry = await persistence.upsertEntry({
      ip: "203.0.113.5",
      vendor: "acme-ip-intel",
      score: 42,
      rawResponse: { risk: "medium" },
      queriedAt: now,
      expiresAt: later,
    });

    assert.match(entry._id, /^ipl4_/);
    assert.equal(entry.ip, "203.0.113.5");
    assert.equal(store.botblockerIpApiLookupsV4.length, 1);
    assert.equal(store.botblockerIpApiLookupsV6.length, 0);
  });

  it("creates a v6 entry in the separate v6 collection", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpApiLookupPersistence(db);

    const entry = await persistence.upsertEntry({
      ip: "2001:db8::1",
      vendor: "acme-ip-intel",
      score: 10,
      rawResponse: { risk: "low" },
      queriedAt: now,
      expiresAt: later,
    });

    assert.match(entry._id, /^ipl6_/);
    assert.equal(store.botblockerIpApiLookupsV6.length, 1);
    assert.equal(store.botblockerIpApiLookupsV4.length, 0);
  });

  it("refreshes an existing entry for the same IP instead of duplicating it", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpApiLookupPersistence(db);

    const first = await persistence.upsertEntry({
      ip: "203.0.113.5",
      vendor: "acme-ip-intel",
      score: 10,
      rawResponse: { risk: "low" },
      queriedAt: now,
      expiresAt: later,
    });
    const second = await persistence.upsertEntry({
      ip: "203.0.113.5",
      vendor: "acme-ip-intel",
      score: 95,
      rawResponse: { risk: "high" },
      queriedAt: later,
      expiresAt: later,
    });

    assert.equal(second._id, first._id);
    assert.equal(store.botblockerIpApiLookupsV4.length, 1);
    assert.equal(second.score, 95);
    assert.deepEqual(second.rawResponse, { risk: "high" });
  });

  it("rejects a value that is not a valid IPv4/IPv6 address", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpApiLookupPersistence(db);

    await assert.rejects(
      persistence.upsertEntry({
        ip: "not-an-ip",
        vendor: "acme-ip-intel",
        score: 0,
        rawResponse: {},
        queriedAt: now,
        expiresAt: later,
      }),
    );
  });

  it("finds an entry by raw IP across either family", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpApiLookupPersistence(db);
    await persistence.upsertEntry({
      ip: "2001:db8::1",
      vendor: "acme-ip-intel",
      score: 5,
      rawResponse: {},
      queriedAt: now,
      expiresAt: later,
    });

    const found = await persistence.findByIp("2001:0DB8:0:0::1");
    assert.equal(found?.ip, "2001:db8::1");
    assert.equal(await persistence.findByIp("203.0.113.5"), undefined);
    assert.equal(await persistence.findByIp("not-an-ip"), undefined);
  });
});
