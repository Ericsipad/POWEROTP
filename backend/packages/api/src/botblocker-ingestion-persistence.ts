import { isDeepStrictEqual } from "node:util";

import type { CanonicalReportRequest } from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

import {
  botBlockerRetentionExpiresAt,
  botBlockerSessionInputRetentionExpiresAt,
  createRiskEventId,
  type BotBlockerScope,
  type CanonicalReportServerEvidence,
  type DurableRiskEventDocument,
  type GateSessionDocument,
  type UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";
import {
  BotBlockerSessionPersistence,
  BotBlockerSessionPersistenceError,
} from "./botblocker-session-persistence.js";

export type BotBlockerIngestionResult = "accepted" | "duplicate" | "stale";
export {
  BotBlockerSessionPersistenceError as BotBlockerIngestionPersistenceError,
};

export class BotBlockerIngestionPersistence {
  readonly #client: MongoClient;
  readonly #gateSessions;
  readonly #userIntelligence;
  readonly #riskEvents;
  readonly #sessions: BotBlockerSessionPersistence;

  constructor(
    db: Db,
    client: MongoClient,
    private readonly scoreProfile?: (
      scope: BotBlockerScope,
      userIntelligenceId: string,
    ) => Promise<unknown>,
    private readonly notifyDataReady?: (
      scope: BotBlockerScope,
      gateSessionId: string,
    ) => Promise<void>,
  ) {
    this.#client = client;
    this.#gateSessions = db.collection<GateSessionDocument>("gateSessions");
    this.#userIntelligence =
      db.collection<UserIntelligenceDocument>("userIntelligence");
    this.#riskEvents = db.collection<DurableRiskEventDocument>("riskEvents");
    this.#sessions = new BotBlockerSessionPersistence(
      db,
      client,
      scoreProfile,
      notifyDataReady,
    );
  }

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    return this.#sessions.findGateSession(scope, gateSessionId);
  }

  async findCurrentSessionData(
    scope: BotBlockerScope,
    gateSessionId: string,
  ) {
    const gateSession = await this.#sessions.findGateSession(
      scope,
      gateSessionId,
    );
    if (!gateSession) return undefined;
    const profile = await this.#userIntelligence.findOne({
      _id: gateSession.userIntelligenceId,
      ...scope,
    });
    if (!profile?.currentScore) return undefined;
    return {
      currentScore: profile.currentScore,
      ...(gateSession.latestDecision
        ? { decision: gateSession.latestDecision }
        : {}),
      updatedAt: profile.updatedAt,
    };
  }

  openGateSession(
    input: Parameters<BotBlockerSessionPersistence["openGateSession"]>[0],
  ) {
    return this.#sessions.openGateSession(input);
  }

  saveVisitorTokenMetadata(
    input: Parameters<
      BotBlockerSessionPersistence["saveVisitorTokenMetadata"]
    >[0],
  ) {
    return this.#sessions.saveVisitorTokenMetadata(input);
  }

  async ingestReport(
    scope: BotBlockerScope,
    report: CanonicalReportRequest,
    serverEvidence: CanonicalReportServerEvidence,
    pageUrl: string | undefined,
    now: Date,
  ): Promise<BotBlockerIngestionResult> {
    const { gateSessionId, reportSequence } = report;
    const key = { ...scope, gateSessionId, reportSequence };
    const existing = await this.#riskEvents.findOne(key);
    if (existing) {
      return sameReport(existing, report, pageUrl)
        ? "duplicate"
        : "stale";
    }

    let outcome: BotBlockerIngestionResult = "stale";
    let userIntelligenceId: string | undefined;
    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const replay = await this.#riskEvents.findOne(key, { session });
        if (replay) {
          outcome = sameReport(replay, report, pageUrl)
            ? "duplicate"
            : "stale";
          return;
        }
        const gateSession = await this.#advanceSequence(
          scope,
          gateSessionId,
          reportSequence,
          now,
          session,
        );
        if (!gateSession) return;
        userIntelligenceId = gateSession.userIntelligenceId;

        const document: DurableRiskEventDocument = {
          _id: createRiskEventId(),
          ...scope,
          userIntelligenceId,
          gateSessionId,
          reportSequence,
          recordType: "canonical_report",
          report,
          serverEvidence,
          ...(pageUrl ? { pageUrl } : {}),
          occurredAt: new Date(report.issuedAt),
          createdAt: now,
          updatedAt: now,
          retentionExpiresAt: botBlockerSessionInputRetentionExpiresAt(
            new Date(report.issuedAt),
          ),
        };
        await this.#riskEvents.insertOne(document, { session });

        const behavior = report.payload.behaviorReport;
        await this.#userIntelligence.updateOne(
          { _id: userIntelligenceId, ...scope },
          {
            $set: {
              ...(behavior ? { latestEvidence: behavior.evidence } : {}),
              lastObservedAt: now,
              updatedAt: now,
              retentionExpiresAt: botBlockerRetentionExpiresAt(now),
            },
            ...(behavior
              ? {
                  $inc: {
                    behaviorReportCount: 1,
                    ...(behavior.evidence.pageView
                      ? {
                          pageViewCount: 1,
                          totalPageDurationMs:
                            behavior.evidence.pageView.durationMs,
                          totalActiveDurationMs:
                            behavior.evidence.pageView.activeDurationMs,
                        }
                      : {}),
                  },
                }
              : {}),
          },
          { session },
        );
        outcome = "accepted";
      });
    });

    if (
      (outcome as BotBlockerIngestionResult) === "accepted" &&
      userIntelligenceId
    ) {
      const score = await this.scoreProfile?.(scope, userIntelligenceId);
      if (score !== undefined) {
        await this.notifyDataReady?.(scope, gateSessionId);
      }
    }
    return outcome;
  }

  #advanceSequence(
    scope: BotBlockerScope,
    gateSessionId: string,
    sequence: number,
    now: Date,
    session: ClientSession,
  ) {
    return this.#gateSessions.findOneAndUpdate(
      {
        _id: gateSessionId,
        ...scope,
        lastAppliedSequence: { $lt: sequence },
      },
      {
        $set: {
          lastAppliedSequence: sequence,
          lastObservedAt: now,
          updatedAt: now,
          retentionExpiresAt: botBlockerSessionInputRetentionExpiresAt(now),
        },
      },
      { returnDocument: "after", session },
    );
  }
}

function sameReport(
  existing: DurableRiskEventDocument,
  report: CanonicalReportRequest,
  pageUrl: string | undefined,
): boolean {
  return existing.recordType === "canonical_report" &&
    isDeepStrictEqual(existing.report, report) &&
    existing.pageUrl === pageUrl;
}
