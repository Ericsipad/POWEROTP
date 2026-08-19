import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BehaviorReport, RiskEventBatch } from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import {
  BotBlockerIngestionPersistence,
} from "./botblocker-ingestion-persistence.js";
import {
  BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS,
  type DurableRiskEventDocument,
  type GateSessionDocument,
} from "./botblocker-intelligence-persistence.js";

const now = new Date("2026-08-16T04:00:00.000Z");
const scope = {
  customerId: "usr_owner",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const otherScope = {
  customerId: "usr_owner",
  projectId: "prj_other_123456789",
  siteId: "bbs_other_123456789",
};
const pageUrl = "https://customer.example/account";

function behaviorReport(sequence: number): BehaviorReport {
  return {
    protocolVersion: 1,
    trigger: sequence === 0 ? "initial" : "recurring",
    sequence: {
      gateSessionId: "bgs_session_123456789",
      sequence,
      issuedAt: now.getTime() - 1_000,
    },
    evidence: {
      routePath: "/account",
      clicks: [{ category: "link", powerOtpId: "profile" }],
      mouseDirectness: { averageDirectnessRatio: 0.5, sampleCount: 1 },
      scroll: { smoothnessScore: 0.9, highSpeedEventCount: 0 },
      honeypotActivations: [],
      environment: {
        evidenceVersion: 1,
        sensorVersion: "1.0.0",
        automationIndicators: [],
      },
      pageView: {
        pageId: "account",
        pageName: "Account",
        durationMs: 30_000,
        activeDurationMs: 28_000,
        documentWidth: 1_200,
        documentHeight: 2_400,
        pointerHeatmap: {
          gridSize: 32,
          bins: [{ column: 4, row: 8, sampleCount: 12, dwellMs: 1_000 }],
        },
      },
    },
  };
}

function riskBatch(sequence: number): RiskEventBatch {
  return {
    protocolVersion: 1,
    siteId: scope.siteId,
    sequence: {
      gateSessionId: "bgs_session_123456789",
      sequence,
      issuedAt: now.getTime(),
    },
    events: [{
      kind: "automation_indicator",
      occurredAt: now.getTime() - 500,
    }],
  };
}

function fixture() {
  const gateSessions: GateSessionDocument[] = [{
    _id: "bgs_session_123456789",
    ...scope,
    userIntelligenceId: "bui_owner_123456789",
    initialRequest: {
      request: {
        protocolVersion: 1,
        siteId: scope.siteId,
        gateSessionId: "bgs_session_123456789",
        audience: "https://customer.example",
        nonce: "nonce_initial_request_123456",
        issuedAt: now.getTime(),
        payload: {
          gateSessionId: "bgs_session_123456789",
          request: {
            siteId: scope.siteId,
            method: "GET",
            path: "/account",
          },
          browser: {
            protocolVersion: 1,
            evidence: behaviorReport(0).evidence,
            proofs: {},
          },
        },
      },
      risk: {},
      serverObservedAt: now,
    },
    state: "active",
    lastAppliedSequence: -1,
    startedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: now,
  }];
  const riskEvents: DurableRiskEventDocument[] = [];
  const aggregate = {
    behaviorReportCount: 0,
    pageViewCount: 0,
    totalPageDurationMs: 0,
    totalActiveDurationMs: 0,
  };
  const scoringCalls: string[] = [];
  const db = {
    collection(name: string) {
      if (name === "gateSessions") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            gateSessions.find((row) => matches(row, filter)) ?? null,
          findOneAndUpdate: async (
            filter: Record<string, unknown>,
            update: { $set: Partial<GateSessionDocument> },
          ) => {
            const row = gateSessions.find((candidate) => matches(candidate, filter));
            if (!row) return null;
            Object.assign(row, update.$set);
            return row;
          },
        };
      }
      if (name === "riskEvents") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            riskEvents.find((row) => matches(row, filter)) ?? null,
          insertOne: async (document: DurableRiskEventDocument) => {
            riskEvents.push(document);
          },
          insertMany: async (documents: DurableRiskEventDocument[]) => {
            riskEvents.push(...documents);
          },
        };
      }
      return {
        updateOne: async (
          _filter: Record<string, unknown>,
          update: { $inc?: Partial<typeof aggregate> },
        ) => {
          for (const key of Object.keys(aggregate) as (keyof typeof aggregate)[]) {
            aggregate[key] += update.$inc?.[key] ?? 0;
          }
        },
      };
    },
  } as unknown as Db;
  const client = {
    withSession: async (
      work: (session: {
        withTransaction: (transaction: () => Promise<void>) => Promise<void>;
      }) => Promise<void>,
    ) => work({ withTransaction: async (transaction) => transaction() }),
  } as unknown as MongoClient;
  return {
    persistence: new BotBlockerIngestionPersistence(
      db,
      client,
      async (_scope, userIntelligenceId) => {
        scoringCalls.push(userIntelligenceId);
      },
    ),
    gateSessions,
    riskEvents,
    aggregate,
    scoringCalls,
  };
}

describe("BotBlockerIngestionPersistence", () => {
  it("persists one sanitized behavior report and treats its replay idempotently", async () => {
    const state = fixture();
    const report = behaviorReport(0);

    assert.equal(
      await state.persistence.ingestBehaviorReport(scope, report, pageUrl, now),
      "accepted",
    );
    assert.equal(
      await state.persistence.ingestBehaviorReport(scope, report, pageUrl, now),
      "duplicate",
    );
    assert.equal(state.riskEvents.length, 1);
    assert.deepEqual(state.scoringCalls, ["bui_owner_123456789"]);
    assert.deepEqual(state.aggregate, {
      behaviorReportCount: 1,
      pageViewCount: 1,
      totalPageDurationMs: 30_000,
      totalActiveDurationMs: 28_000,
    });
    const stored = state.riskEvents[0]!;
    assert.equal(stored.recordType, "behavior_report");
    assert.equal(stored.pageUrl, pageUrl);
    assert.deepEqual(stored.report, report);
    assert.equal(stored.report.evidence.pageView?.activeDurationMs, 28_000);
    assert.equal(
      stored.retentionExpiresAt.getTime() - stored.occurredAt.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
    );
    assert.equal(JSON.stringify(stored).includes("pointerCoordinates"), false);
    assert.equal(JSON.stringify(stored).includes("fingerprintHash"), false);
  });

  it("rejects stale and cross-project behavior reports atomically", async () => {
    const state = fixture();
    assert.equal(
      await state.persistence.ingestBehaviorReport(
        scope,
        behaviorReport(2),
        pageUrl,
        now,
      ),
      "accepted",
    );
    assert.equal(
      await state.persistence.ingestBehaviorReport(
        scope,
        behaviorReport(1),
        pageUrl,
        now,
      ),
      "stale",
    );
    assert.equal(
      await state.persistence.ingestBehaviorReport(
        otherScope,
        behaviorReport(3),
        pageUrl,
        now,
      ),
      "stale",
    );
    assert.equal(state.riskEvents.length, 1);
    assert.deepEqual(state.scoringCalls, ["bui_owner_123456789"]);
    assert.equal(state.gateSessions[0]!.lastAppliedSequence, 2);
  });

  it("persists ordered risk events once with retention anchored to occurrence", async () => {
    const state = fixture();
    const batch = riskBatch(1);

    assert.equal(
      await state.persistence.ingestRiskEvents(scope, batch, now),
      "accepted",
    );
    assert.equal(
      await state.persistence.ingestRiskEvents(scope, batch, now),
      "duplicate",
    );
    assert.equal(state.riskEvents.length, 1);
    const stored = state.riskEvents[0]!;
    assert.equal(stored.recordType, "risk_signal");
    assert.equal(stored.eventIndex, 1);
    assert.equal(
      stored.retentionExpiresAt.getTime() - stored.occurredAt.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
    );
  });
});

function matches(
  row: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$lt" in value) {
      return Number(row[key]) < Number((value as { $lt: number }).$lt);
    }
    return row[key] === value;
  });
}
