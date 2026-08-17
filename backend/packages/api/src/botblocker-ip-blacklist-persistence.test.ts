import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  BotBlockerIpBlacklistPersistence,
  IpBlacklistValidationError,
  ensureBotBlockerIpBlacklistIndexes,
  identifyBlacklistEntryFamily,
  toIpBlacklistEntryResponse,
  type IpBlacklistDocument,
} from "./botblocker-ip-blacklist-persistence.js";

interface CapturedIndex {
  collection: string;
  keys: Record<string, number>;
  options?: Record<string, unknown>;
}

function fakeDb() {
  const store: Record<string, IpBlacklistDocument[]> = {
    botblockerIpBlacklistV4: [],
    botblockerIpBlacklistV6: [],
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
      findOne: async (filter: { _id?: string; ip?: string }) =>
        rows.find(
          (row) =>
            (filter._id === undefined || row._id === filter._id) &&
            (filter.ip === undefined || row.ip === filter.ip),
        ) ?? null,
      findOneAndUpdate: async (
        filter: { _id?: string; ip?: string },
        update: {
          $set?: Partial<IpBlacklistDocument>;
          $unset?: Record<string, "">;
          $setOnInsert?: Partial<IpBlacklistDocument>;
        },
        options?: { upsert?: boolean },
      ) => {
        let row = rows.find(
          (candidate) =>
            (filter._id === undefined || candidate._id === filter._id) &&
            (filter.ip === undefined || candidate.ip === filter.ip),
        );
        if (!row) {
          if (!options?.upsert) return null;
          row = {
            ...(filter.ip !== undefined ? { ip: filter.ip } : {}),
            ...update.$setOnInsert,
          } as IpBlacklistDocument;
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
      find: (filter: { createdAt?: { $lt: Date } }) => {
        const matching = rows.filter(
          (row) => !filter.createdAt || row.createdAt < filter.createdAt.$lt,
        );
        return {
          sort: () => ({
            limit: (n: number) => ({
              toArray: async () =>
                [...matching]
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, n),
            }),
          }),
        };
      },
    };
  }

  const db = { collection: (name: string) => collectionFor(name) } as unknown as Db;
  return { db, store, indexes };
}

const now = new Date("2026-08-16T12:00:00.000Z");
const later = new Date("2026-08-16T12:05:00.000Z");

describe("identifyBlacklistEntryFamily", () => {
  it("decodes the family encoded in the entry ID prefix", () => {
    assert.equal(identifyBlacklistEntryFamily("bl4_abc"), "v4");
    assert.equal(identifyBlacklistEntryFamily("bl6_abc"), "v6");
    assert.equal(identifyBlacklistEntryFamily("bgs_abc"), undefined);
  });
});

describe("ensureBotBlockerIpBlacklistIndexes", () => {
  it("creates a unique IP index and a createdAt index for both families", async () => {
    const { db, indexes } = fakeDb();
    await ensureBotBlockerIpBlacklistIndexes(db);

    for (const collection of ["botblockerIpBlacklistV4", "botblockerIpBlacklistV6"]) {
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
          (index) => index.collection === collection && index.keys.createdAt === -1,
        ),
      );
    }
  });
});

describe("BotBlockerIpBlacklistPersistence", () => {
  it("creates a v4 entry with a family-prefixed ID for a dotted-quad IP", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);

    const entry = await persistence.upsertEntry({
      ip: "203.0.113.5",
      reason: "Confirmed scraper",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now,
    });

    assert.match(entry._id, /^bl4_/);
    assert.equal(entry.ip, "203.0.113.5");
    assert.equal(store.botblockerIpBlacklistV4.length, 1);
    assert.equal(store.botblockerIpBlacklistV6.length, 0);
  });

  it("creates a v6 entry in the separate v6 collection", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);

    const entry = await persistence.upsertEntry({
      ip: "2001:db8::1",
      reason: "Confirmed scraper",
      provenance: "automatic_detection",
      createdBy: "usr_platform_admin",
      now,
    });

    assert.match(entry._id, /^bl6_/);
    assert.equal(store.botblockerIpBlacklistV6.length, 1);
    assert.equal(store.botblockerIpBlacklistV4.length, 0);
  });

  it("refreshes an existing entry for the same IP instead of duplicating it", async () => {
    const { db, store } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);

    const first = await persistence.upsertEntry({
      ip: "203.0.113.5",
      reason: "Initial reason",
      provenance: "operator_manual",
      expiresAt: later,
      createdBy: "usr_platform_admin",
      now,
    });
    await persistence.revokeEntry(first._id, now);

    const second = await persistence.upsertEntry({
      ip: "203.0.113.5",
      reason: "Updated reason",
      provenance: "automatic_detection",
      createdBy: "usr_platform_admin",
      now: later,
    });

    assert.equal(second._id, first._id);
    assert.equal(store.botblockerIpBlacklistV4.length, 1);
    assert.equal(second.reason, "Updated reason");
    assert.equal(second.provenance, "automatic_detection");
    assert.equal(second.revokedAt, undefined);
    assert.equal(second.expiresAt, undefined);
  });

  it("rejects a value that is not a valid IPv4/IPv6 address", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);

    await assert.rejects(
      persistence.upsertEntry({
        ip: "not-an-ip",
        reason: "reason",
        provenance: "operator_manual",
        createdBy: "usr_platform_admin",
        now,
      }),
      IpBlacklistValidationError,
    );
  });

  it("revokes an entry by ID and returns undefined for an unknown entry", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);
    const entry = await persistence.upsertEntry({
      ip: "203.0.113.5",
      reason: "reason",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now,
    });

    const revoked = await persistence.revokeEntry(entry._id, later);
    assert.equal(revoked?.revokedAt?.getTime(), later.getTime());

    assert.equal(await persistence.revokeEntry("bl4_missing", later), undefined);
    assert.equal(await persistence.revokeEntry("bgs_wrong_prefix", later), undefined);
  });

  it("finds an entry by raw IP across either family", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);
    await persistence.upsertEntry({
      ip: "2001:db8::1",
      reason: "reason",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now,
    });

    const found = await persistence.findByIp("2001:0DB8:0:0::1");
    assert.equal(found?.ip, "2001:db8::1");
    assert.equal(await persistence.findByIp("203.0.113.5"), undefined);
    assert.equal(await persistence.findByIp("not-an-ip"), undefined);
  });

  it("lists only the requested family's entries, most recent first", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerIpBlacklistPersistence(db);
    await persistence.upsertEntry({
      ip: "203.0.113.1",
      reason: "first",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now,
    });
    await persistence.upsertEntry({
      ip: "203.0.113.2",
      reason: "second",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now: later,
    });
    await persistence.upsertEntry({
      ip: "2001:db8::1",
      reason: "v6 entry",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      now,
    });

    const v4Entries = await persistence.listEntries("v4", { limit: 50 });
    assert.equal(v4Entries.length, 2);
    assert.deepEqual(v4Entries.map((entry) => entry.ip), [
      "203.0.113.2",
      "203.0.113.1",
    ]);

    const v6Entries = await persistence.listEntries("v6", { limit: 50 });
    assert.equal(v6Entries.length, 1);
  });
});

describe("toIpBlacklistEntryResponse", () => {
  it("maps optional expiry/revocation fields only when present", () => {
    const entry: IpBlacklistDocument = {
      _id: "bl4_abc",
      ip: "203.0.113.5",
      reason: "reason",
      provenance: "operator_manual",
      createdBy: "usr_platform_admin",
      createdAt: now,
      updatedAt: now,
    };

    const withoutOptional = toIpBlacklistEntryResponse(entry, "v4");
    assert.equal("expiresAt" in withoutOptional, false);
    assert.equal("revokedAt" in withoutOptional, false);

    const withOptional = toIpBlacklistEntryResponse(
      { ...entry, expiresAt: later, revokedAt: later },
      "v4",
    );
    assert.equal(withOptional.expiresAt, later.toISOString());
    assert.equal(withOptional.revokedAt, later.toISOString());
  });
});
