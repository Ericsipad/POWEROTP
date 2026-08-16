import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserEvidence } from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import {
  BOTBLOCKER_MATCH_LOOKBACK_SECONDS,
  BOTBLOCKER_RETENTION_SECONDS,
  type GateSessionDocument,
  type UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";
import {
  BotBlockerSessionPersistence,
  BotBlockerSessionPersistenceError,
} from "./botblocker-session-persistence.js";

const now = new Date("2026-08-16T04:00:00.000Z");
const scope = {
  customerId: "usr_owner",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const browserEvidence: BrowserEvidence = {
  routePath: "/",
  clicks: [],
  mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
  scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
  honeypotActivations: [],
  environment: {
    evidenceVersion: 1,
    sensorVersion: "1.0.0",
    automationIndicators: [],
  },
};

function fixture(existing?: UserIntelligenceDocument | GateSessionDocument) {
  const gateSessions: GateSessionDocument[] =
    existing && "userIntelligenceId" in existing ? [existing] : [];
  const intelligence: UserIntelligenceDocument[] =
    existing && "gateSessionCount" in existing ? [existing] : [];
  let matchingCutoff: Date | undefined;
  const db = {
    collection(name: string) {
      if (name === "gateSessions") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            gateSessions.find((row) => row._id === filter._id) ?? null,
          insertOne: async (document: GateSessionDocument) => {
            gateSessions.push(document);
          },
        };
      }
      if (name === "userIntelligence") {
        return {
          findOne: async (filter: {
            fingerprintHash?: string;
            "ipObservations.ipHash"?: string;
            lastObservedAt?: { $gte: Date };
          }) => {
            matchingCutoff = filter.lastObservedAt?.$gte;
            return intelligence.find(
              (row) =>
                row.fingerprintHash === filter.fingerprintHash &&
                row.ipObservations.some(
                  (observation) =>
                    observation.ipHash === filter["ipObservations.ipHash"],
                ) &&
                (!matchingCutoff || row.lastObservedAt >= matchingCutoff),
            ) ?? null;
          },
          insertOne: async (document: UserIntelligenceDocument) => {
            intelligence.push(document);
          },
          updateOne: async (
            filter: { _id: string },
            update: {
              $set: Partial<UserIntelligenceDocument>;
              $inc: { gateSessionCount: number };
            },
          ) => {
            const row = intelligence.find((item) => item._id === filter._id)!;
            Object.assign(row, update.$set);
            row.gateSessionCount += update.$inc.gateSessionCount;
          },
        };
      }
      return {
        findOne: async () => null,
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
    persistence: new BotBlockerSessionPersistence(db, client),
    gateSessions,
    intelligence,
    matchingCutoff: () => matchingCutoff,
  };
}

describe("BotBlockerSessionPersistence", () => {
  it("creates scoped session/intelligence records with only keyed lookup hashes", async () => {
    const state = fixture();
    const session = await state.persistence.openGateSession({
      scope,
      gateSessionId: "bgs_session_123456789",
      fingerprintHash: "a".repeat(64),
      ipHash: "b".repeat(64),
      evidence: browserEvidence,
      now,
    });

    assert.equal(state.gateSessions.length, 1);
    assert.equal(state.intelligence.length, 1);
    assert.equal(session.lastAppliedSequence, -1);
    assert.equal(session.fingerprintHash, "a".repeat(64));
    assert.equal(session.ipHash, "b".repeat(64));
    assert.equal("clientIp" in session, false);
    assert.equal("rawFingerprint" in session, false);
    assert.equal(
      session.retentionExpiresAt.getTime() - now.getTime(),
      BOTBLOCKER_RETENTION_SECONDS * 1_000,
    );
    assert.equal(
      state.intelligence[0]!.retentionExpiresAt.getTime() - now.getTime(),
      BOTBLOCKER_RETENTION_SECONDS * 1_000,
    );
    assert.equal(
      now.getTime() - state.matchingCutoff()!.getTime(),
      BOTBLOCKER_MATCH_LOOKBACK_SECONDS * 1_000,
    );
  });

  it("matches only a recent scoped fingerprint and records repeatable IP observations", async () => {
    const existing: UserIntelligenceDocument = {
      _id: "bui_existing_123456",
      ...scope,
      fingerprintHash: "a".repeat(64),
      ipObservations: [{
        ipHash: "b".repeat(64),
        firstObservedAt: new Date(now.getTime() - 1_000),
        lastObservedAt: new Date(now.getTime() - 1_000),
        observationCount: 1,
      }],
      gateSessionCount: 1,
      behaviorReportCount: 2,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: now,
    };
    const state = fixture(existing);
    const session = await state.persistence.openGateSession({
      scope,
      gateSessionId: "bgs_second_123456789",
      fingerprintHash: "a".repeat(64),
      ipHash: "b".repeat(64),
      evidence: browserEvidence,
      now,
    });

    assert.equal(session.userIntelligenceId, existing._id);
    assert.equal(existing.gateSessionCount, 2);
    assert.equal(existing.ipObservations[0]!.observationCount, 2);
    assert.equal(state.intelligence.length, 1);
  });

  it("never treats a repeated IP by itself as a visitor identity", async () => {
    const existing: UserIntelligenceDocument = {
      _id: "bui_existing_123456",
      ...scope,
      fingerprintHash: "c".repeat(64),
      ipObservations: [{
        ipHash: "b".repeat(64),
        firstObservedAt: now,
        lastObservedAt: now,
        observationCount: 1,
      }],
      gateSessionCount: 1,
      behaviorReportCount: 0,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: now,
    };
    const state = fixture(existing);
    const session = await state.persistence.openGateSession({
      scope,
      gateSessionId: "bgs_distinct_1234567",
      fingerprintHash: "a".repeat(64),
      ipHash: "b".repeat(64),
      evidence: browserEvidence,
      now,
    });

    assert.notEqual(session.userIntelligenceId, existing._id);
    assert.equal(state.intelligence.length, 2);
  });

  it("rejects reuse of a session identifier from another project", async () => {
    const state = fixture({
      _id: "bgs_shared_123456789",
      ...scope,
      userIntelligenceId: "bui_owner_123456789",
      fingerprintHash: "a".repeat(64),
      state: "active",
      lastAppliedSequence: 0,
      startedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: now,
    });
    await assert.rejects(
      state.persistence.openGateSession({
        scope: { ...scope, projectId: "prj_other_123456789" },
        gateSessionId: "bgs_shared_123456789",
        fingerprintHash: "a".repeat(64),
        evidence: browserEvidence,
        now,
      }),
      BotBlockerSessionPersistenceError,
    );
  });
});
