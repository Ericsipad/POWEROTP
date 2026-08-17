import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  BotBlockerNetworkRangePersistence,
  ensureBotBlockerNetworkRangeIndexes,
  type NetworkRangeV4Document,
  type NetworkRangeV6Document,
} from "./botblocker-network-range-persistence.js";
import { ipv6ToFixedWidthHex } from "./ip-utils.js";

interface CapturedIndex {
  collection: string;
  keys: Record<string, number>;
}

function fakeDb() {
  const v4: NetworkRangeV4Document[] = [];
  const v6: NetworkRangeV6Document[] = [];
  const indexes: CapturedIndex[] = [];
  const store = { botblockerNetworkRangesV4: v4, botblockerNetworkRangesV6: v6 };

  function collectionFor(name: keyof typeof store) {
    const rows = store[name];
    return {
      createIndex: async (keys: Record<string, number>) => {
        indexes.push({ collection: name, keys });
        return `${name}_index`;
      },
      findOne: async (
        filter: Record<string, { $lte: number | string }>,
        options: { sort: Record<string, number> },
      ) => {
        const [field, condition] = Object.entries(filter)[0]!;
        const [sortField, sortDirection] = Object.entries(options.sort)[0]!;
        const matching = (rows as Array<Record<string, unknown>>).filter(
          (row) => (row[field] as number | string) <= condition.$lte,
        );
        matching.sort((a, b) => {
          const left = a[sortField] as number | string;
          const right = b[sortField] as number | string;
          const diff = left < right ? -1 : left > right ? 1 : 0;
          return sortDirection === -1 ? -diff : diff;
        });
        return matching[0] ?? null;
      },
    };
  }

  const db = {
    collection: (name: string) => collectionFor(name as keyof typeof store),
  } as unknown as Db;
  return { db, v4, v6, indexes };
}

const IMPORT_BASE = {
  sourceDataset: "maxmind_geolite2_asn",
  importBatchId: "batch_2026_08_17",
  importedAt: new Date("2026-08-17T00:00:00.000Z"),
};

describe("ensureBotBlockerNetworkRangeIndexes", () => {
  it("creates the range-start index for both families", async () => {
    const { db, indexes } = fakeDb();
    await ensureBotBlockerNetworkRangeIndexes(db);

    assert.ok(
      indexes.some(
        (index) =>
          index.collection === "botblockerNetworkRangesV4" && index.keys.rangeStart === 1,
      ),
    );
    assert.ok(
      indexes.some(
        (index) =>
          index.collection === "botblockerNetworkRangesV6" && index.keys.rangeStartHex === 1,
      ),
    );
  });
});

describe("BotBlockerNetworkRangePersistence.lookupByIp", () => {
  it("finds the v4 range that brackets an IP inside it", async () => {
    const { db, v4 } = fakeDb();
    v4.push({
      _id: "nr4_1",
      rangeStart: 0x0a000000, // 10.0.0.0
      rangeEnd: 0x0a0000ff, // 10.0.0.255
      cidr: "10.0.0.0/24",
      prefixLength: 24,
      asn: 64500,
      asnOrg: "Example Org",
      ...IMPORT_BASE,
    });
    const persistence = new BotBlockerNetworkRangePersistence(db);

    const match = await persistence.lookupByIp("10.0.0.42");
    assert.deepEqual(match, {
      asn: 64500,
      asnOrg: "Example Org",
      cidr: "10.0.0.0/24",
      prefixLength: 24,
    });
  });

  it("returns undefined for an IP just outside the range on either side", async () => {
    const { db, v4 } = fakeDb();
    v4.push({
      _id: "nr4_1",
      rangeStart: 0x0a000000,
      rangeEnd: 0x0a0000ff,
      cidr: "10.0.0.0/24",
      prefixLength: 24,
      asn: 64500,
      asnOrg: "Example Org",
      ...IMPORT_BASE,
    });
    const persistence = new BotBlockerNetworkRangePersistence(db);

    assert.equal(await persistence.lookupByIp("10.0.1.0"), undefined);
    assert.equal(await persistence.lookupByIp("9.255.255.255"), undefined);
  });

  it("picks the correct partition among several non-overlapping v4 ranges", async () => {
    const { db, v4 } = fakeDb();
    v4.push(
      {
        _id: "nr4_1",
        rangeStart: 0x0a000000,
        rangeEnd: 0x0a0000ff,
        cidr: "10.0.0.0/24",
        prefixLength: 24,
        asn: 64500,
        asnOrg: "First Org",
        ...IMPORT_BASE,
      },
      {
        _id: "nr4_2",
        rangeStart: 0x0a000100,
        rangeEnd: 0x0a0001ff,
        cidr: "10.0.1.0/24",
        prefixLength: 24,
        asn: 64501,
        asnOrg: "Second Org",
        ...IMPORT_BASE,
      },
    );
    const persistence = new BotBlockerNetworkRangePersistence(db);

    const match = await persistence.lookupByIp("10.0.1.5");
    assert.equal(match?.asn, 64501);
    assert.equal(match?.asnOrg, "Second Org");
  });

  it("finds the v6 range that brackets an IP inside it via fixed-width hex", async () => {
    const { db, v6 } = fakeDb();
    v6.push({
      _id: "nr6_1",
      rangeStartHex: ipv6ToFixedWidthHex("2001:db8::")!,
      rangeEndHex: ipv6ToFixedWidthHex("2001:db8::ffff")!,
      cidr: "2001:db8::/112",
      prefixLength: 112,
      asn: 64502,
      asnOrg: "V6 Org",
      ...IMPORT_BASE,
    });
    const persistence = new BotBlockerNetworkRangePersistence(db);

    const match = await persistence.lookupByIp("2001:db8::42");
    assert.deepEqual(match, {
      asn: 64502,
      asnOrg: "V6 Org",
      cidr: "2001:db8::/112",
      prefixLength: 112,
    });

    assert.equal(await persistence.lookupByIp("2001:db8::1:0"), undefined);
  });

  it("returns undefined for an invalid IP or an empty dataset", async () => {
    const { db } = fakeDb();
    const persistence = new BotBlockerNetworkRangePersistence(db);

    assert.equal(await persistence.lookupByIp("not-an-ip"), undefined);
    assert.equal(await persistence.lookupByIp("203.0.113.5"), undefined);
  });
});
