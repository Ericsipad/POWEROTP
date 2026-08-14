import type {
  BehaviorReport,
  BotBlockerChallengeState,
  BotBlockerDecisionOutcome,
  BrowserEvidence,
  ReportSequence,
  RiskEvent,
  VerificationType,
} from "@powerotp/contracts";
import type { Db, Filter } from "mongodb";

import { createId } from "./security.js";

export const BOTBLOCKER_RETENTION_SECONDS = 548 * 24 * 60 * 60;
export const BOTBLOCKER_MATCH_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;

export const createGateSessionId = () => createId("bgs");
export const createUserIntelligenceId = () => createId("bui");
export const createRiskEventId = () => createId("bre");
export const createBotBlockerChallengeId = () => createId("bbc");

interface BotBlockerScope {
  customerId: string;
  projectId: string;
  siteId: string;
}

export interface GateSessionDocument extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  /** Server-derived fingerprint and keyed IP lookup hashes only. Raw device
   * input and raw IP addresses are not durable fields in this collection. */
  fingerprintHash: string;
  ipHash?: string;
  state: "active" | "ended";
  latestDecision?: BotBlockerDecisionOutcome;
  lastAppliedSequence: number;
  startedAt: Date;
  lastObservedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export interface IpObservation {
  ipHash: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
}

export interface UserIntelligenceDocument extends BotBlockerScope {
  _id: string;
  /** Non-unique, server-derived lookup evidence. Phase 15 owns derivation
   * and matching; Phase 6 only fixes the durable, project-scoped boundary. */
  fingerprintHash: string;
  ipObservations: IpObservation[];
  latestEvidence?: BrowserEvidence;
  gateSessionCount: number;
  behaviorReportCount: number;
  firstObservedAt: Date;
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

interface RiskEventDocumentBase extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  gateSessionId: string;
  reportSequence: number;
  eventIndex: number;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export interface BehaviorReportEventDocument extends RiskEventDocumentBase {
  recordType: "behavior_report";
  eventIndex: 0;
  report: BehaviorReport;
}

export interface RiskSignalEventDocument extends RiskEventDocumentBase {
  recordType: "risk_signal";
  sequence: ReportSequence;
  event: RiskEvent;
}

export type DurableRiskEventDocument =
  | BehaviorReportEventDocument
  | RiskSignalEventDocument;

export interface BotBlockerChallengeDocument extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  gateSessionId: string;
  state: BotBlockerChallengeState;
  verificationType?: VerificationType;
  verificationRequestId?: string;
  verificationResult?: "succeeded" | "failed";
  issuedAt: Date;
  expiresAt: Date;
  presentedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export function botBlockerRetentionExpiresAt(anchor: Date): Date {
  return new Date(anchor.getTime() + BOTBLOCKER_RETENTION_SECONDS * 1_000);
}

export function botBlockerMatchCutoff(now: Date): Date {
  return new Date(now.getTime() - BOTBLOCKER_MATCH_LOOKBACK_SECONDS * 1_000);
}

export async function ensureBotBlockerIntelligenceIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<GateSessionDocument>("gateSessions").createIndex(
      { customerId: 1, projectId: 1, siteId: 1, startedAt: -1 },
    ),
    db.collection<GateSessionDocument>("gateSessions").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        userIntelligenceId: 1,
        lastObservedAt: -1,
      },
    ),
    db.collection<GateSessionDocument>("gateSessions").createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    db.collection<UserIntelligenceDocument>("userIntelligence").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        fingerprintHash: 1,
        "ipObservations.ipHash": 1,
        lastObservedAt: -1,
      },
    ),
    db.collection<UserIntelligenceDocument>("userIntelligence").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        "ipObservations.ipHash": 1,
        lastObservedAt: -1,
      },
    ),
    db.collection<UserIntelligenceDocument>("userIntelligence").createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    db.collection<DurableRiskEventDocument>("riskEvents").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        gateSessionId: 1,
        reportSequence: 1,
        eventIndex: 1,
      },
      { unique: true },
    ),
    db.collection<DurableRiskEventDocument>("riskEvents").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        userIntelligenceId: 1,
        occurredAt: -1,
      },
    ),
    db.collection<DurableRiskEventDocument>("riskEvents").createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    db.collection<BotBlockerChallengeDocument>("botblockerChallenges").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        gateSessionId: 1,
        issuedAt: -1,
      },
    ),
    db.collection<BotBlockerChallengeDocument>("botblockerChallenges").createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
  ]);
}

export class BotBlockerIntelligencePersistence {
  readonly #gateSessions;
  readonly #userIntelligence;
  readonly #riskEvents;
  readonly #challenges;

  constructor(db: Db) {
    this.#gateSessions = db.collection<GateSessionDocument>("gateSessions");
    this.#userIntelligence =
      db.collection<UserIntelligenceDocument>("userIntelligence");
    this.#riskEvents = db.collection<DurableRiskEventDocument>("riskEvents");
    this.#challenges =
      db.collection<BotBlockerChallengeDocument>("botblockerChallenges");
  }

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    return this.#gateSessions.findOne({ _id: gateSessionId, ...scope });
  }

  advanceGateSessionSequence(
    scope: BotBlockerScope,
    gateSessionId: string,
    sequence: number,
    observedAt: Date,
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
          lastObservedAt: observedAt,
          updatedAt: observedAt,
          retentionExpiresAt: botBlockerRetentionExpiresAt(observedAt),
        },
      },
      { returnDocument: "after" },
    );
  }

  findUserIntelligence(scope: BotBlockerScope, userIntelligenceId: string) {
    return this.#userIntelligence.findOne({
      _id: userIntelligenceId,
      ...scope,
    });
  }

  findChallenge(scope: BotBlockerScope, challengeId: string) {
    return this.#challenges.findOne({ _id: challengeId, ...scope });
  }

  listRiskEvents(scope: BotBlockerScope, gateSessionId: string) {
    const filter: Filter<DurableRiskEventDocument> = {
      gateSessionId,
      ...scope,
    };
    return this.#riskEvents.find(filter).sort({
      reportSequence: 1,
      eventIndex: 1,
    }).toArray();
  }
}
