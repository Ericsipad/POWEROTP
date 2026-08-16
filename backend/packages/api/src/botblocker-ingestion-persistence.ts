import { isDeepStrictEqual } from "node:util";

import type {
  BehaviorReport,
  RiskEventBatch,
} from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

import {
  botBlockerRetentionExpiresAt,
  createRiskEventId,
  type BehaviorReportEventDocument,
  type BotBlockerScope,
  type DurableRiskEventDocument,
  type GateSessionDocument,
  type RiskSignalEventDocument,
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

  constructor(db: Db, client: MongoClient) {
    this.#client = client;
    this.#gateSessions = db.collection<GateSessionDocument>("gateSessions");
    this.#userIntelligence =
      db.collection<UserIntelligenceDocument>("userIntelligence");
    this.#riskEvents = db.collection<DurableRiskEventDocument>("riskEvents");
    this.#sessions = new BotBlockerSessionPersistence(db, client);
  }

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    return this.#sessions.findGateSession(scope, gateSessionId);
  }

  openGateSession(
    input: Parameters<BotBlockerSessionPersistence["openGateSession"]>[0],
  ) {
    return this.#sessions.openGateSession(input);
  }

  async ingestBehaviorReport(
    scope: BotBlockerScope,
    report: BehaviorReport,
    pageUrl: string,
    now: Date,
  ): Promise<BotBlockerIngestionResult> {
    const gateSessionId = report.sequence.gateSessionId;
    const reportSequence = report.sequence.sequence;
    const existing = await this.#riskEvents.findOne({
      ...scope,
      gateSessionId,
      reportSequence,
      eventIndex: 0,
    });
    if (existing) {
      return existing.recordType === "behavior_report" &&
          existing.pageUrl === pageUrl &&
          isDeepStrictEqual(existing.report, report)
        ? "duplicate"
        : "stale";
    }

    let outcome: BotBlockerIngestionResult = "stale";
    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const replay = await this.#riskEvents.findOne(
          {
            ...scope,
            gateSessionId,
            reportSequence,
            eventIndex: 0,
          },
          { session },
        );
        if (replay) {
          outcome = replay.recordType === "behavior_report" &&
              replay.pageUrl === pageUrl &&
              isDeepStrictEqual(replay.report, report)
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

        const occurredAt = new Date(report.sequence.issuedAt);
        const document: BehaviorReportEventDocument = {
          _id: createRiskEventId(),
          ...scope,
          userIntelligenceId: gateSession.userIntelligenceId,
          gateSessionId,
          reportSequence,
          eventIndex: 0,
          recordType: "behavior_report",
          pageUrl,
          report,
          occurredAt,
          createdAt: now,
          updatedAt: now,
          retentionExpiresAt: botBlockerRetentionExpiresAt(occurredAt),
        };
        await this.#riskEvents.insertOne(document, { session });
        await this.#userIntelligence.updateOne(
          { _id: gateSession.userIntelligenceId, ...scope },
          {
            $set: {
              latestEvidence: report.evidence,
              lastObservedAt: now,
              updatedAt: now,
              retentionExpiresAt: botBlockerRetentionExpiresAt(now),
            },
            $inc: {
              behaviorReportCount: 1,
              ...(report.evidence.pageView
                ? {
                    pageViewCount: 1,
                    totalPageDurationMs: report.evidence.pageView.durationMs,
                    totalActiveDurationMs:
                      report.evidence.pageView.activeDurationMs,
                  }
                : {}),
            },
          },
          { session },
        );
        outcome = "accepted";
      });
    });
    return outcome;
  }

  async ingestRiskEvents(
    scope: BotBlockerScope,
    batch: RiskEventBatch,
    now: Date,
  ): Promise<BotBlockerIngestionResult> {
    const gateSessionId = batch.sequence.gateSessionId;
    const reportSequence = batch.sequence.sequence;
    const existing = await Promise.all(
      batch.events.map((_, index) =>
        this.#riskEvents.findOne({
          ...scope,
          gateSessionId,
          reportSequence,
          eventIndex: index + 1,
        })
      ),
    );
    if (existing.some(Boolean)) {
      return existing.every((document, index) =>
        document?.recordType === "risk_signal" &&
        isDeepStrictEqual(document.sequence, batch.sequence) &&
        isDeepStrictEqual(document.event, batch.events[index])
      )
        ? "duplicate"
        : "stale";
    }

    let outcome: BotBlockerIngestionResult = "stale";
    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const replays = await Promise.all(
          batch.events.map((_, index) =>
            this.#riskEvents.findOne(
              {
                ...scope,
                gateSessionId,
                reportSequence,
                eventIndex: index + 1,
              },
              { session },
            )
          ),
        );
        if (replays.some(Boolean)) {
          outcome = replays.every((document, index) =>
            document?.recordType === "risk_signal" &&
            isDeepStrictEqual(document.sequence, batch.sequence) &&
            isDeepStrictEqual(document.event, batch.events[index])
          )
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

        const documents: RiskSignalEventDocument[] = batch.events.map(
          (event, index) => {
            const occurredAt = new Date(event.occurredAt);
            return {
              _id: createRiskEventId(),
              ...scope,
              userIntelligenceId: gateSession.userIntelligenceId,
              gateSessionId,
              reportSequence,
              eventIndex: index + 1,
              recordType: "risk_signal",
              sequence: batch.sequence,
              event,
              occurredAt,
              createdAt: now,
              updatedAt: now,
              retentionExpiresAt: botBlockerRetentionExpiresAt(occurredAt),
            };
          },
        );
        await this.#riskEvents.insertMany(documents, { session });
        await this.#userIntelligence.updateOne(
          { _id: gateSession.userIntelligenceId, ...scope },
          {
            $set: {
              lastObservedAt: now,
              updatedAt: now,
              retentionExpiresAt: botBlockerRetentionExpiresAt(now),
            },
          },
          { session },
        );
        outcome = "accepted";
      });
    });
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
          retentionExpiresAt: botBlockerRetentionExpiresAt(now),
        },
      },
      { returnDocument: "after", session },
    );
  }
}
