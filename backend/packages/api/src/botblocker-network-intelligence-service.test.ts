import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AsnType } from "@powerotp/contracts";

import type { AsnClassificationDocument } from "./botblocker-asn-classification-persistence.js";
import type { AsnTypeScoreDocument } from "./botblocker-asn-type-score-persistence.js";
import type { IpBlacklistDocument } from "./botblocker-ip-blacklist-persistence.js";
import type { IpReputationResult } from "./botblocker-ip-reputation-service.js";
import { BotBlockerNetworkIntelligenceService } from "./botblocker-network-intelligence-service.js";
import type { NetworkRangeMatch } from "./botblocker-network-range-persistence.js";

const now = new Date("2026-08-17T12:00:00.000Z");

function service(options: {
  blacklistEntry?: IpBlacklistDocument;
  rangeMatch?: NetworkRangeMatch;
  classification?: AsnClassificationDocument;
  typeScores?: Array<{ document: AsnTypeScoreDocument; persisted: boolean }>;
  reputation?: IpReputationResult;
}) {
  const reputationCalls: string[] = [];
  return new BotBlockerNetworkIntelligenceService(
    { findByIp: async () => options.blacklistEntry },
    { lookupByIp: async () => options.rangeMatch },
    { findByAsn: async () => options.classification },
    { listAllScores: async () => options.typeScores ?? defaultTypeScores() },
    {
      getReputation: async (ip: string) => {
        reputationCalls.push(ip);
        return options.reputation;
      },
    },
  );
}

function defaultTypeScores(): Array<{ document: AsnTypeScoreDocument; persisted: boolean }> {
  const types: AsnType[] = [
    "datacenter",
    "residential_isp",
    "isp_static",
    "known_proxy",
    "unclassified",
  ];
  return types.map((asnType) => ({
    document: { _id: asnType, score: 0, requiresApiLookup: false, updatedAt: now, updatedBy: "" },
    persisted: false,
  }));
}

describe("BotBlockerNetworkIntelligenceService.resolve", () => {
  it("resolves no signal for a request with no client IP", async () => {
    const svc = service({});
    assert.deepEqual(await svc.resolve(undefined, now), { blacklisted: false });
  });

  it("short-circuits to blacklisted on an active blacklist match, skipping the network chain", async () => {
    const svc = service({
      blacklistEntry: {
        _id: "bl4_1",
        ip: "203.0.113.5",
        reason: "Confirmed scraper",
        provenance: "operator_manual",
        createdBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
    });
    const result = await svc.resolve("203.0.113.5", now);
    assert.deepEqual(result, { blacklisted: true });
  });

  it("ignores a revoked blacklist entry and falls through to the network chain", async () => {
    const svc = service({
      blacklistEntry: {
        _id: "bl4_1",
        ip: "203.0.113.5",
        reason: "reason",
        provenance: "operator_manual",
        revokedAt: now,
        createdBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
    });
    const result = await svc.resolve("203.0.113.5", now);
    assert.equal(result.blacklisted, false);
  });

  it("ignores an expired blacklist entry and falls through to the network chain", async () => {
    const svc = service({
      blacklistEntry: {
        _id: "bl4_1",
        ip: "203.0.113.5",
        reason: "reason",
        provenance: "operator_manual",
        expiresAt: new Date(now.getTime() - 1_000),
        createdBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
    });
    const result = await svc.resolve("203.0.113.5", now);
    assert.equal(result.blacklisted, false);
  });

  it("resolves no signal for an IP outside every loaded network range", async () => {
    const svc = service({});
    assert.deepEqual(await svc.resolve("203.0.113.5", now), { blacklisted: false });
  });

  it("treats an ASN with no classification row as unclassified", async () => {
    const svc = service({
      rangeMatch: { asn: 64500, asnOrg: "Example Org", cidr: "203.0.113.0/24", prefixLength: 24 },
    });
    const result = await svc.resolve("203.0.113.5", now);
    assert.deepEqual(result.networkClassification, {
      asn: 64500,
      asnOrg: "Example Org",
      asnType: "unclassified",
      score: 0,
      requiresApiLookup: false,
    });
    assert.equal(result.ipReputation, undefined);
  });

  it("returns the fast-immediate branch without an API call when requiresApiLookup is false", async () => {
    const svc = service({
      rangeMatch: { asn: 64500, asnOrg: "Example Org", cidr: "203.0.113.0/24", prefixLength: 24 },
      classification: {
        _id: 64500,
        asnType: "residential_isp",
        classificationSource: "manual",
        updatedBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
      typeScores: [
        {
          document: {
            _id: "residential_isp",
            score: 5,
            requiresApiLookup: false,
            updatedAt: now,
            updatedBy: "usr_platform_admin",
          },
          persisted: true,
        },
      ],
    });
    const result = await svc.resolve("203.0.113.5", now);
    assert.equal(result.blacklisted, false);
    assert.equal(result.networkClassification?.asnType, "residential_isp");
    assert.equal(result.networkClassification?.score, 5);
    assert.equal(result.networkClassification?.requiresApiLookup, false);
    assert.equal(result.ipReputation, undefined);
  });

  it("awaits the vendor lookup only when the resolved type requires it", async () => {
    const svc = service({
      rangeMatch: { asn: 64777, asnOrg: "Suspicious Hosting", cidr: "198.51.100.0/24", prefixLength: 24 },
      classification: {
        _id: 64777,
        asnType: "known_proxy",
        classificationSource: "ai_research",
        updatedBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
      typeScores: [
        {
          document: {
            _id: "known_proxy",
            score: 40,
            requiresApiLookup: true,
            updatedAt: now,
            updatedBy: "usr_platform_admin",
          },
          persisted: true,
        },
      ],
      reputation: { vendor: "acme-ip-intel", score: 70, rawResponse: { risk: "high" } },
    });
    const result = await svc.resolve("198.51.100.5", now);
    assert.deepEqual(result.networkClassification, {
      asn: 64777,
      asnOrg: "Suspicious Hosting",
      asnType: "known_proxy",
      score: 40,
      requiresApiLookup: true,
    });
    assert.deepEqual(result.ipReputation, { vendor: "acme-ip-intel", score: 70 });
  });

  it("still returns the network classification when the vendor lookup resolves undefined", async () => {
    const svc = service({
      rangeMatch: { asn: 64777, asnOrg: "Suspicious Hosting", cidr: "198.51.100.0/24", prefixLength: 24 },
      classification: {
        _id: 64777,
        asnType: "known_proxy",
        classificationSource: "ai_research",
        updatedBy: "usr_platform_admin",
        createdAt: now,
        updatedAt: now,
      },
      typeScores: [
        {
          document: {
            _id: "known_proxy",
            score: 40,
            requiresApiLookup: true,
            updatedAt: now,
            updatedBy: "usr_platform_admin",
          },
          persisted: true,
        },
      ],
      reputation: undefined,
    });
    const result = await svc.resolve("198.51.100.5", now);
    assert.equal(result.networkClassification?.asnType, "known_proxy");
    assert.equal(result.ipReputation, undefined);
  });
});
