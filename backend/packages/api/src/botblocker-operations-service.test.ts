import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { BotBlockerOperationsService } from "./botblocker-operations-service.js";
import type { AuditDocument } from "./persistence.js";
import { ProjectError } from "./project-service.js";

const now = new Date("2026-08-14T04:00:00.000Z");
const scope = {
  customerId: "usr_owner",
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
};

function fixture() {
  const audits: AuditDocument[] = [];
  const db = {
    collection(name: string) {
      if (name === "projects") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            filter._id === scope.projectId &&
            filter.customerId === scope.customerId
              ? { _id: scope.projectId, customerId: scope.customerId }
              : null,
        };
      }
      if (name === "botblockerSites") {
        return {
          findOne: async () => ({ _id: scope.siteId, ...scope }),
        };
      }
      if (name === "policyReleases") {
        return { countDocuments: async () => 0 };
      }
      return {
        insertOne: async (document: AuditDocument) => {
          audits.push(document);
        },
      };
    },
  } as unknown as Db;
  const intelligence = {
    listUserIntelligence: async () => [
      {
        _id: "bui_1234567890123456",
        ...scope,
        currentIp: { ip: "203.0.113.5", blacklisted: false },
        recentIpHistory: [],
        gateSessionCount: 2,
        behaviorReportCount: 4,
        pageViewCount: 4,
        totalPageDurationMs: 95_000,
        totalActiveDurationMs: 81_000,
        firstObservedAt: now,
        lastObservedAt: now,
      },
    ],
    findGateSessionById: async () => ({
      _id: "bgs_1234567890123456",
      ...scope,
    }),
    listRiskEvents: async () => [
      {
        _id: "bre_1234567890123456",
        recordType: "canonical_report" as const,
        reportSequence: 1,
        occurredAt: now,
      },
    ],
    listChallenges: async () => [
      {
        _id: "bbc_1234567890123456",
        state: "pending" as const,
        issuedAt: now,
      },
    ],
  };
  const service = new BotBlockerOperationsService(
    db,
    intelligence as never,
    async () => true,
    {
      BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_active",
      BOTBLOCKER_INTELLIGENCE_HASH_SECRET: "i".repeat(32),
      BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: "h".repeat(32),
      BOTBLOCKER_VISITOR_TOKEN_SECRET: "v".repeat(32),
      BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: "w".repeat(32),
      BOTBLOCKER_RUNTIME_ORIGIN: "https://verify.powerotp.com",
    },
  );
  return { service, audits };
}

describe("BotBlockerOperationsService", () => {
  it("returns only data-minimized project-owned visitor summaries", async () => {
    const { service } = fixture();
    const response = await service.visitors(
      scope.customerId,
      scope.projectId,
      { limit: 50 },
    );
    assert.equal(response.visitors.length, 1);
    assert.equal(response.visitors[0]?.visitorId, "bui_1234567890123456");
    assert.equal(response.visitors[0]?.totalActiveDurationMs, 81_000);
    assert.equal(response.visitors[0]?.ip, "203.0.113.5");
    assert.equal("fingerprintHash" in response.visitors[0]!, false);
    assert.equal("currentIp" in response.visitors[0]!, false);
    await assert.rejects(
      service.visitors("usr_other", scope.projectId, { limit: 50 }),
      ProjectError,
    );
    await assert.rejects(
      service.visitors(scope.customerId, scope.projectId, {
        limit: 50,
        siteId: "bbs_other_1234567890123456",
      }),
      ProjectError,
    );
  });

  it("builds and audits a real persistence-backed decision trace", async () => {
    const { service, audits } = fixture();
    const response = await service.decisionTrace(
      "usr_platform_admin",
      "bgs_1234567890123456",
    );
    assert.equal(response.entries.length, 2);
    assert.deepEqual(
      response.entries.map((entry) => entry.stage),
      ["risk_event", "challenge"],
    );
    assert.equal(audits[0]?.action, "botblocker_decision_trace.viewed");
  });

  it("reports degraded real health when no policy release exists", async () => {
    const { service } = fixture();
    const health = await service.health();
    assert.equal(health.state, "degraded");
    assert.equal(
      health.dependencies.find((item) => item.name === "policy_releases")
        ?.state,
      "degraded",
    );
  });
});
