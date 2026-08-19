import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CanonicalReportRequest } from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import { BotBlockerIngestionPersistence } from "./botblocker-ingestion-persistence.js";
import {
  BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS,
  type DurableRiskEventDocument,
  type GateSessionDocument,
} from "./botblocker-intelligence-persistence.js";

const now = new Date("2026-08-16T04:00:00.000Z");
const scope = {
  customerId: "usr_owner_123456",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const otherScope = {
  customerId: "usr_owner_123456",
  projectId: "prj_other_123456789",
  siteId: "bbs_other_123456789",
};
const pageUrl = "https://customer.example/account";

function report(sequence: number): CanonicalReportRequest {
  const order = {
    gateSessionId: "bgs_session_123456789",
    sequence,
    issuedAt: now.getTime() - 1_000,
  };
  return {
    protocolVersion: 1,
    siteId: scope.siteId,
    gateSessionId: order.gateSessionId,
    audience: "https://customer.example",
    reportSequence: sequence,
    nonce: `report_nonce_${sequence}_123456789`,
    issuedAt: order.issuedAt,
    payload: {
      behaviorReport: {
        protocolVersion: 1,
        trigger: sequence === 0 ? "initial" : "recurring",
        sequence: order,
        evidence: {
          routePath: "/account",
          clicks: [{ category: "link", powerOtpId: "profile" }],
          mouseDirectness: { averageDirectnessRatio: 0.5, sampleCount: 1 },
          scroll: { smoothnessScore: 0.9, highSpeedEventCount: 0 },
          honeypotActivations: [],
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
      },
      riskSignals: [{
        kind: "automation_indicator",
        occurredAt: now.getTime() - 500,
      }],
    },
  };
}

function fixture(scorePersisted = true) {
  const gateSessions: GateSessionDocument[] = [{
    _id: "bgs_session_123456789",
    ...scope,
    userIntelligenceId: "bui_owner_123456789",
    initialReport: {
      report: {
        ...report(0),
        reportSequence: -1,
        payload: {},
      },
      serverEvidence: {},
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
  const callbackCalls: string[] = [];
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
        };
      }
      return {
        findOne: async () => ({
          currentScore: { status: "available", score: 42 },
          updatedAt: now,
        }),
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
        return scorePersisted ? {} : undefined;
      },
      async (_scope, gateSessionId) => {
        callbackCalls.push(gateSessionId);
      },
    ),
    gateSessions,
    riskEvents,
    aggregate,
    scoringCalls,
    callbackCalls,
  };
}

describe("BotBlockerIngestionPersistence", () => {
  it("persists one canonical row and treats exact replay idempotently", async () => {
    const state = fixture();
    const value = report(0);

    assert.equal(
      await state.persistence.ingestReport(scope, value, {}, pageUrl, now),
      "accepted",
    );
    assert.equal(
      await state.persistence.ingestReport(scope, value, {}, pageUrl, now),
      "duplicate",
    );
    assert.equal(state.riskEvents.length, 1);
    assert.deepEqual(state.scoringCalls, ["bui_owner_123456789"]);
    assert.deepEqual(state.callbackCalls, ["bgs_session_123456789"]);
    assert.deepEqual(state.aggregate, {
      behaviorReportCount: 1,
      pageViewCount: 1,
      totalPageDurationMs: 30_000,
      totalActiveDurationMs: 28_000,
    });
    const stored = state.riskEvents[0]!;
    assert.equal(stored.recordType, "canonical_report");
    assert.equal(stored.pageUrl, pageUrl);
    assert.deepEqual(stored.report, value);
    assert.equal(stored.report.payload.riskSignals?.length, 1);
    assert.equal(
      stored.retentionExpiresAt.getTime() - stored.occurredAt.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
    );
  });

  it("rejects changed replay, stale order, and cross-project reports atomically", async () => {
    const state = fixture();
    assert.equal(
      await state.persistence.ingestReport(scope, report(2), {}, pageUrl, now),
      "accepted",
    );
    assert.equal(
      await state.persistence.ingestReport(scope, report(1), {}, pageUrl, now),
      "stale",
    );
    assert.equal(
      await state.persistence.ingestReport(
        otherScope,
        report(3),
        {},
        pageUrl,
        now,
      ),
      "stale",
    );
    assert.equal(state.riskEvents.length, 1);
    assert.equal(state.gateSessions[0]!.lastAppliedSequence, 2);
  });

  it("does not notify when post-commit scoring did not replace current state", async () => {
    const state = fixture(false);
    assert.equal(
      await state.persistence.ingestReport(scope, report(0), {}, pageUrl, now),
      "accepted",
    );
    assert.deepEqual(state.scoringCalls, ["bui_owner_123456789"]);
    assert.deepEqual(state.callbackCalls, []);
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
