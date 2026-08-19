import type {
  AsnType,
  BehaviorReport,
  BotBlockerChallengeState,
  BotBlockerDecisionOutcome,
  BrowserEvidence,
  FingerprintVerifyLookup,
  FingerprintVerifySource,
  RapidAuthRequest,
  ReportSequence,
  RiskEvent,
  UserIntelligenceRecord,
  VerificationType,
} from "@powerotp/contracts";
import type { ClientSession, Db, Filter } from "mongodb";

import { createId } from "./security.js";

export const BOTBLOCKER_RETENTION_SECONDS = 548 * 24 * 60 * 60;
export const BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
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

export interface InitialSessionRequestSnapshotDocument {
  request: RapidAuthRequest;
  risk: {
    ipBlacklisted?: boolean;
    latestDecision?: BotBlockerDecisionOutcome;
    networkClassification?: GateSessionNetworkClassification;
    ipReputation?: GateSessionIpReputation;
  };
  serverObservedAt: Date;
}

export interface VisitorTokenMetadataDocument {
  tokenId: string;
  expiresAt: Date;
  nonceDigest: string;
  tokenDigest: string;
}

export interface GateSessionDocument extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  initialRequest: InitialSessionRequestSnapshotDocument;
  tokenMetadata?: VisitorTokenMetadataDocument;
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

/** One exact-IP observation carried on `userIntelligence` — either the
 * profile's `currentIp` or one `recentIpHistory` entry. `asnScore` is the
 * observation-time configured ASN-type score (Phase 16 step 7) and is
 * omitted, never zero-substituted, when no network-range match was
 * available. `blacklisted` is the observation-time dedicated exact-IP
 * blacklist result and is never inferred from a decision outcome. */
export interface IpEvidence {
  ip: string;
  asnScore?: number;
  blacklisted: boolean;
}

export interface IpReuseCounts {
  distinctProfiles1d: number;
  distinctProfiles7d: number;
  distinctProfiles30d: number;
}

/** Separate system-wide and same-site distinct-profile counts for the
 * profile's current exact IP, over the latest 1/7/30 days. Risk evidence
 * only — never used to select, merge, or blacklist a profile. */
export interface IpReuseSummary {
  global: IpReuseCounts;
  site: IpReuseCounts;
}

export interface UserIntelligenceDocument extends BotBlockerScope,
  Pick<
    UserIntelligenceRecord,
    | "osCpu"
    | "screenResolution"
    | "platform"
    | "touchSupport"
    | "vendor"
    | "architecture"
    | "applePay"
  > {
  _id: string;
  /** Internal authoritative Passport account reference. This remains absent
   * until a later Passport phase verifies and binds a real Passport user. */
  passportUserId?: string;
  /** Bounded stable inputs projected from the accepted raw fingerprint.
   * The lookup is derived from these persisted row values, never directly
   * from an inbound request or from fingerprintData. */
  fingerprintVerifySource?: FingerprintVerifySource;
  fingerprintVerifyLookup?: FingerprintVerifyLookup;
  /** Current exact trusted IP plus its observation-time ASN/blacklist
   * evidence, using latest replacement (Phase 17A gate-session profile
   * synchronization). */
  currentIp?: IpEvidence;
  /** Unique least-recently-used list of at most 20 prior IP entries. An
   * IP change moves the outgoing `currentIp` here as the newest entry;
   * a repeated exact IP never appends a duplicate. */
  recentIpHistory: IpEvidence[];
  /** Rolling distinct-profile reuse counts for `currentIp.ip`, refreshed
   * alongside it. Absent whenever `currentIp` itself is absent. */
  currentIpReuse?: IpReuseSummary;
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

export interface InitialRequestEventDocument extends RiskEventDocumentBase {
  recordType: "initial_request";
  reportSequence: -1;
  eventIndex: 0;
  initialRequest: InitialSessionRequestSnapshotDocument;
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
  | InitialRequestEventDocument
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

export function botBlockerSessionInputRetentionExpiresAt(anchor: Date): Date {
  return new Date(
    anchor.getTime() + BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
  );
}

export function botBlockerMatchCutoff(now: Date): Date {
  return new Date(now.getTime() - BOTBLOCKER_MATCH_LOOKBACK_SECONDS * 1_000);
}

export function sameBotBlockerScope(
  document: BotBlockerScope,
  scope: BotBlockerScope,
): boolean {
  return document.customerId === scope.customerId &&
    document.projectId === scope.projectId &&
    document.siteId === scope.siteId;
}

function ipReuseCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

function countDistinctProfiles(
  rows: Pick<GateSessionDocument, "userIntelligenceId" | "lastObservedAt">[],
  cutoffs: { oneDay: Date; sevenDay: Date; thirtyDay: Date },
): IpReuseCounts {
  const distinctSince = (cutoff: Date) =>
    new Set(
      rows
        .filter((row) => row.lastObservedAt >= cutoff)
        .map((row) => row.userIntelligenceId),
    ).size;
  return {
    distinctProfiles1d: distinctSince(cutoffs.oneDay),
    distinctProfiles7d: distinctSince(cutoffs.sevenDay),
    distinctProfiles30d: distinctSince(cutoffs.thirtyDay),
  };
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
    /** Supports `countIpReuse`'s exact-IP, time-windowed scan across the
     * retained 90-day session dataset — deliberately not scoped to one
     * customer/project/site, because the system-wide reuse count is
     * computed from this same index without a scope filter. */
    db.collection<GateSessionDocument>("gateSessions").createIndex(
      { ip: 1, lastObservedAt: -1 },
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
        "currentIp.ip": 1,
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
          retentionExpiresAt:
            botBlockerSessionInputRetentionExpiresAt(observedAt),
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

  /**
   * Separate system-wide (`global`) and same-site (`site`) distinct-profile
   * counts for the exact current IP over the latest 1/7/30 days (Phase 17A
   * gate-session profile synchronization, item 4). Counts distinct
   * `userIntelligenceId` values from the retained `gateSessions` dataset —
   * the trusted session/profile relationship — never raw report/session
   * counts. Accepts the caller's transaction `session` so a newly inserted
   * gate session is visible to this read within the same transaction.
   */
  async countIpReuse(
    ip: string,
    scope: BotBlockerScope,
    now: Date,
    session?: ClientSession,
  ): Promise<IpReuseSummary> {
    const cutoffs = {
      oneDay: ipReuseCutoff(now, 1),
      sevenDay: ipReuseCutoff(now, 7),
      thirtyDay: ipReuseCutoff(now, 30),
    };
    const rows = await this.#gateSessions.find(
      { ip, lastObservedAt: { $gte: cutoffs.thirtyDay } },
      {
        projection: {
          userIntelligenceId: 1,
          lastObservedAt: 1,
          customerId: 1,
          projectId: 1,
          siteId: 1,
        },
        session,
      },
    ).toArray();
    return {
      global: countDistinctProfiles(rows, cutoffs),
      site: countDistinctProfiles(
        rows.filter((row) => sameBotBlockerScope(row, scope)),
        cutoffs,
      ),
    };
  }
}
