import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BotBlockerIpApiLookupPersistence, IpApiLookupDocument } from "./botblocker-ip-api-lookup-persistence.js";
import { BotBlockerIpReputationService } from "./botblocker-ip-reputation-service.js";

const now = new Date("2026-08-17T00:00:00.000Z");
const past = new Date("2026-08-16T00:00:00.000Z");
const future = new Date("2026-08-18T00:00:00.000Z");

function fakeCache(initial: IpApiLookupDocument[] = []) {
  const rows = [...initial];
  const upserts: Array<Parameters<BotBlockerIpApiLookupPersistence["upsertEntry"]>[0]> = [];
  const cache = {
    findByIp: async (ip: string) => rows.find((row) => row.ip === ip),
    upsertEntry: async (input: Parameters<BotBlockerIpApiLookupPersistence["upsertEntry"]>[0]) => {
      upserts.push(input);
      const document: IpApiLookupDocument = { _id: "ipl4_seeded", ...input };
      rows.push(document);
      return document;
    },
  } as unknown as BotBlockerIpApiLookupPersistence;
  return { cache, rows, upserts };
}

describe("BotBlockerIpReputationService.getReputation", () => {
  it("resolves undefined for an invalid IP without touching the cache or vendor", async () => {
    const { cache } = fakeCache();
    const service = new BotBlockerIpReputationService(cache, {
      BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: "acme-ip-intel",
      BOTBLOCKER_IP_REPUTATION_VENDOR_URL: "https://vendor.example.com",
      BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: "key",
    });

    assert.equal(await service.getReputation("not-an-ip", now), undefined);
  });

  it("returns a fresh, unexpired cache hit without calling the vendor", async () => {
    const { cache, upserts } = fakeCache([
      {
        _id: "ipl4_1",
        ip: "203.0.113.5",
        vendor: "acme-ip-intel",
        score: 30,
        rawResponse: { risk: "medium" },
        queriedAt: past,
        expiresAt: future,
      },
    ]);
    const service = new BotBlockerIpReputationService(cache, {
      BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: "acme-ip-intel",
      BOTBLOCKER_IP_REPUTATION_VENDOR_URL: "https://vendor.example.com",
      BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: "key",
    });

    const result = await service.getReputation("203.0.113.5", now);
    assert.deepEqual(result, { vendor: "acme-ip-intel", score: 30, rawResponse: { risk: "medium" } });
    assert.equal(upserts.length, 0);
  });

  it("resolves undefined on a cache miss when no vendor is configured, without blocking", async () => {
    const { cache, upserts } = fakeCache();
    const service = new BotBlockerIpReputationService(cache, {
      BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: undefined,
      BOTBLOCKER_IP_REPUTATION_VENDOR_URL: undefined,
      BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: undefined,
    });

    assert.equal(await service.getReputation("203.0.113.5", now), undefined);
    assert.equal(upserts.length, 0);
  });

  it("resolves undefined on an expired cache row when no vendor is configured", async () => {
    const { cache } = fakeCache([
      {
        _id: "ipl4_1",
        ip: "203.0.113.5",
        vendor: "acme-ip-intel",
        score: 30,
        rawResponse: {},
        queriedAt: past,
        expiresAt: past,
      },
    ]);
    const service = new BotBlockerIpReputationService(cache, {
      BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: undefined,
      BOTBLOCKER_IP_REPUTATION_VENDOR_URL: undefined,
      BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: undefined,
    });

    assert.equal(await service.getReputation("203.0.113.5", now), undefined);
  });

  it("resolves undefined instead of throwing when the configured vendor call fails", async () => {
    const { cache, upserts } = fakeCache();
    const service = new BotBlockerIpReputationService(cache, {
      BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: "acme-ip-intel",
      BOTBLOCKER_IP_REPUTATION_VENDOR_URL: "https://vendor.example.com",
      BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: "key",
    });

    const result = await service.getReputation("203.0.113.5", now);
    assert.equal(result, undefined);
    assert.equal(upserts.length, 0);
  });
});
