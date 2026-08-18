import type {
  AsnType,
  BehaviorReport,
  BotBlockerChallengeState,
  BotBlockerDecisionOutcome,
  BrowserEvidence,
  FingerprintVerifyLookup,
  FingerprintVerifySource,
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

export interface BotBlockerScope {
  customerId: string;
  projectId: string;
  siteId: string;
}

/** Session-level snapshot of the fast-immediate network/ASN classification
 * chain (Phase 16 step 7 — `botblockerNetworkRangesV4`/`V6` ->
 * `botblockerAsnClassifications` -> `botblockerAsnTypeScores`), taken once at
 * gate-session creation. `asnOrg` is copied from the matched network-range
 * row (always present there), not from the classification row's own
 * optional denormalized copy. This is informational network input only —
 * per the Phase 16 plan's explicit exclusions, no final weighted/thresholded
 * decision is derived from it here (that is Phase 17 scope). */
export interface GateSessionNetworkClassification {
  asn: number;
  asnOrg: string;
  asnType: AsnType;
  score: number;
  requiresApiLookup: boolean;
}

/** Session-level snapshot of an awaited external vendor lookup
 * (`BotBlockerIpReputationService`), taken only when the resolved ASN
 * type's `requiresApiLookup` is `true`. The raw vendor payload stays in
 * `botblockerIpApiLookupsV4`/`V6`'s own cache row, not duplicated here. */
export interface GateSessionIpReputation {
  vendor: string;
  score: number;
}

export interface GateSessionDocument extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  /** Trusted request IP is stored raw for site-owner reporting and
   * security correlation. It is never identity authority. */
  ip?: string;
  state: "active" | "ended";
  latestDecision?: BotBlockerDecisionOutcome;
  networkClassification?: GateSessionNetworkClassification;
  ipReputation?: GateSessionIpReputation;
  lastAppliedSequence: number;
  startedAt: Date;
  lastObservedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export interface IpObservation {
  ip: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
}

export interface UserIntelligenceDocument extends BotBlockerScope {
  _id: string;
  /** Internal authoritative Passport account reference. This remains absent
   * until a later Passport phase verifies and binds a real Passport user. */
  passportUserId?: string;
  /** Bounded stable inputs projected from the accepted raw fingerprint.
   * The lookup is derived from these persisted row values, never directly
   * from an inbound request or from fingerprintData. */
  fingerprintVerifySource?: FingerprintVerifySource;
  fingerprintVerifyLookup?: FingerprintVerifyLookup;
  ipObservations: IpObservation[];
  latestEvidence?: BrowserEvidence;
  gateSessionCount: number;
  behaviorReportCount: number;
  pageViewCount?: number;
  totalPageDurationMs?: number;
  totalActiveDurationMs?: number;
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
  /** Derived from the authenticated request audience plus sanitized path. */
  pageUrl: string;
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
        "fingerprintVerifyLookup.hash": 1,
        lastObservedAt: -1,
      },
    ),
    db.collection<UserIntelligenceDocument>("userIntelligence").createIndex(
      {
        customerId: 1,
        projectId: 1,
        siteId: 1,
        "ipObservations.ip": 1,
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

  listGateSessions(
    scope: BotBlockerScope,
    options: { limit: number; before?: Date },
  ) {
    return this.#gateSessions
      .find({
        ...scope,
        ...(options.before
          ? { startedAt: { $lt: options.before } }
          : {}),
      })
      .sort({ startedAt: -1 })
      .limit(options.limit)
      .toArray();
  }

  findGateSessionById(gateSessionId: string) {
    return this.#gateSessions.findOne({ _id: gateSessionId });
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

  listUserIntelligence(
    scope: BotBlockerScope,
    options: { limit: number; before?: Date },
  ) {
    return this.#userIntelligence
      .find({
        ...scope,
        ...(options.before
          ? { lastObservedAt: { $lt: options.before } }
          : {}),
      })
      .sort({ lastObservedAt: -1 })
      .limit(options.limit)
      .toArray();
  }

  findChallenge(scope: BotBlockerScope, challengeId: string) {
    return this.#challenges.findOne({ _id: challengeId, ...scope });
  }

  listChallenges(scope: BotBlockerScope, gateSessionId: string) {
    return this.#challenges
      .find({ ...scope, gateSessionId })
      .sort({ issuedAt: 1 })
      .toArray();
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
