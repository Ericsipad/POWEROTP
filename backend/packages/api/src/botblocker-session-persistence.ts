import { isDeepStrictEqual } from "node:util";

import type {
  BotBlockerDecisionOutcome,
  CanonicalReportRequest,
  FingerprintVector,
  FingerprintVerifySource,
} from "@powerotp/contracts";
import type { ClientSession, Db, MongoClient } from "mongodb";

import {
  deriveFingerprintVerifyLookup,
  projectFingerprintVerifySource,
} from "./botblocker-fingerprint-hash.js";
import {
  FingerprintPersistence,
  FingerprintPersistenceError,
} from "./botblocker-fingerprint-persistence.js";
import {
  BotBlockerIntelligencePersistence,
  botBlockerRetentionExpiresAt,
  botBlockerSessionInputRetentionExpiresAt,
  createRiskEventId,
  createUserIntelligenceId,
  sameBotBlockerScope,
  type BotBlockerScope,
  type DurableRiskEventDocument,
  type GateSessionDocument,
  type GateSessionIpReputation,
  type GateSessionNetworkClassification,
  type CanonicalReportSnapshotDocument,
  type IpEvidence,
  type UserIntelligenceDocument,
  type VisitorTokenMetadataDocument,
} from "./botblocker-intelligence-persistence.js";

export class BotBlockerSessionPersistenceError extends Error {
  constructor(
    readonly code:
      | "scope_mismatch"
      | "session_not_found"
      | "authoritative_binding_not_found"
      | "conflicting_replay"
      | "stale_initial_request",
  ) {
    super(code);
    this.name = "BotBlockerSessionPersistenceError";
  }
}

export class BotBlockerSessionPersistence {
  readonly #client: MongoClient;
  readonly #gateSessions;
  readonly #userIntelligence;
  readonly #riskEvents;
  readonly #fingerprints: FingerprintPersistence;
  readonly #reads: BotBlockerIntelligencePersistence;

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
    this.#fingerprints = new FingerprintPersistence(db);
    this.#reads = new BotBlockerIntelligencePersistence(db);
  }

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    return this.#reads.findGateSession(scope, gateSessionId);
  }

  async openGateSession(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    initialReport: CanonicalReportRequest;
    /** Independent server-only HMAC key. It is used only after stable source
     * values have been projected onto the user-intelligence row. */
    verifyHashSecret?: string;
    /** Trusted server-held binding only. This value is never read from a
     * browser payload. */
    authoritativeUserIntelligenceId?: string;
    ip?: string;
    ipBlacklisted?: boolean;
    /** Set only when the fast-immediate branch's network intelligence
     * chain (Phase 16 step 7) already resolved a visitor-facing outcome
     * before the session was created — currently only a dedicated
     * IP-blacklist match, which always implies `"otp"`. */
    latestDecision?: BotBlockerDecisionOutcome;
    networkClassification?: GateSessionNetworkClassification;
    ipReputation?: GateSessionIpReputation;
    now: Date;
  }): Promise<GateSessionDocument> {
    const userIntelligenceId = createUserIntelligenceId();
    const fingerprint = input.initialReport.payload.fingerprint;
    const evidence = input.initialReport.payload.browserEvidence ??
      input.initialReport.payload.behaviorReport?.evidence;
    const initialReport = initialReportSnapshot(input);
    let result: GateSessionDocument | undefined;
    let profileUpdated = false;

    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const existingById = await this.#gateSessions.findOne(
          { _id: input.gateSessionId },
          { session },
        );
        if (existingById) {
          if (!sameBotBlockerScope(existingById, input.scope)) {
            throw new BotBlockerSessionPersistenceError("scope_mismatch");
          }
          if (
            isDeepStrictEqual(
              existingById.initialReport.report,
              input.initialReport,
            ) &&
            existingById.ip === input.ip
          ) {
            result = existingById;
            return;
          }
          throw new BotBlockerSessionPersistenceError(
            input.initialReport.issuedAt <=
                existingById.initialReport.report.issuedAt
              ? "stale_initial_request"
              : "conflicting_replay",
          );
        }

        let matched: UserIntelligenceDocument | null = null;
        if (input.authoritativeUserIntelligenceId) {
          const bound = await this.#userIntelligence.findOne(
            { _id: input.authoritativeUserIntelligenceId },
            { session },
          );
          if (!bound) {
            throw new BotBlockerSessionPersistenceError(
              "authoritative_binding_not_found",
            );
          }
          if (!sameBotBlockerScope(bound, input.scope)) {
            throw new BotBlockerSessionPersistenceError("scope_mismatch");
          }
          matched = bound;
        } else if (fingerprint) {
          const fingerprintMatch = await this.#fingerprints.findExactVector(
            input.scope,
            fingerprint,
            session,
          );
          if (fingerprintMatch) {
            matched = await this.#userIntelligence.findOne(
              { _id: fingerprintMatch.userIntelligenceId, ...input.scope },
              { session },
            );
            if (!matched) {
              throw new BotBlockerSessionPersistenceError("session_not_found");
            }
          }
        }
        const userId = matched?._id ?? userIntelligenceId;
        let fingerprintAccepted = false;

        result = {
          _id: input.gateSessionId,
          ...input.scope,
          userIntelligenceId: userId,
          initialReport,
          ...(input.ip ? { ip: input.ip } : {}),
          state: "active",
          ...(input.latestDecision ? { latestDecision: input.latestDecision } : {}),
          ...(input.networkClassification
            ? { networkClassification: input.networkClassification }
            : {}),
          ...(input.ipReputation ? { ipReputation: input.ipReputation } : {}),
          lastAppliedSequence: -1,
          startedAt: input.now,
          lastObservedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
          retentionExpiresAt:
            botBlockerSessionInputRetentionExpiresAt(input.now),
        };
        await this.#gateSessions.insertOne(result, { session });

        const occurredAt = new Date(input.initialReport.issuedAt);
        const initialEvent: DurableRiskEventDocument = {
          _id: createRiskEventId(),
          ...input.scope,
          userIntelligenceId: userId,
          gateSessionId: input.gateSessionId,
          reportSequence: -1,
          recordType: "canonical_report",
          report: input.initialReport,
          serverEvidence: initialReport.serverEvidence,
          ...(reportPageUrl(input.initialReport) ? {
            pageUrl: reportPageUrl(input.initialReport),
          } : {}),
          occurredAt,
          createdAt: input.now,
          updatedAt: input.now,
          retentionExpiresAt:
            botBlockerSessionInputRetentionExpiresAt(occurredAt),
        };
        await this.#riskEvents.insertOne(initialEvent, { session });

        if (fingerprint) {
          try {
            const write = await this.#fingerprints.writeCurrent(
              {
                scope: input.scope,
                userIntelligenceId: userId,
                gateSessionId: input.gateSessionId,
                vector: fingerprint,
                observedAt: input.now,
              },
              session,
            );
            fingerprintAccepted = write.outcome === "accepted";
          } catch (error) {
            if (error instanceof FingerprintPersistenceError) {
              throw new BotBlockerSessionPersistenceError(
                error.code === "scope_mismatch"
                  ? "scope_mismatch"
                  : "conflicting_replay",
              );
            }
            throw error;
          }
        }

        const fingerprintProfile = fingerprintAccepted && fingerprint
          ? fingerprintProfileFields(
            matched?.fingerprintVerifySource,
            fingerprint,
            input.verifyHashSecret,
          )
          : {};
        const ipProfile = await this.#ipProfileFields(matched, input, session);
        if (!matched) {
          const intelligence: UserIntelligenceDocument = {
            _id: userId,
            ...input.scope,
            ...fingerprintProfile,
            ...ipProfile,
            ...(evidence ? { latestEvidence: evidence } : {}),
            gateSessionCount: 1,
            behaviorReportCount: 0,
            pageViewCount: 0,
            totalPageDurationMs: 0,
            totalActiveDurationMs: 0,
            firstObservedAt: input.now,
            lastObservedAt: input.now,
            createdAt: input.now,
            updatedAt: input.now,
            retentionExpiresAt: botBlockerRetentionExpiresAt(input.now),
          };
          await this.#userIntelligence.insertOne(intelligence, { session });
        } else {
          await this.#userIntelligence.updateOne(
            { _id: matched._id, ...input.scope },
            {
              $set: {
                ...(evidence ? { latestEvidence: evidence } : {}),
                lastObservedAt: input.now,
                updatedAt: input.now,
                retentionExpiresAt: botBlockerRetentionExpiresAt(input.now),
                ...fingerprintProfile,
                ...ipProfile,
              },
              $inc: { gateSessionCount: 1 },
            },
            { session },
          );
        }
        profileUpdated = true;
      });
    });

    if (!result) {
      throw new BotBlockerSessionPersistenceError("session_not_found");
    }
    if (profileUpdated) {
      const score = await this.scoreProfile?.(
        input.scope,
        result.userIntelligenceId,
      );
      if (score !== undefined) {
        await this.notifyDataReady?.(input.scope, input.gateSessionId);
      }
    }
    return result;
  }

  async saveVisitorTokenMetadata(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    metadata: VisitorTokenMetadataDocument;
    now: Date;
  }): Promise<void> {
    if (input.metadata.expiresAt <= input.now) {
      throw new BotBlockerSessionPersistenceError("stale_initial_request");
    }
    const update = await this.#gateSessions.updateOne(
      { _id: input.gateSessionId, ...input.scope },
      {
        $set: {
          tokenMetadata: input.metadata,
          updatedAt: input.now,
        },
      },
    );
    if (update.matchedCount !== 1) {
      throw new BotBlockerSessionPersistenceError("session_not_found");
    }
  }

  /**
   * Phase 17A gate-session profile synchronization, item 4: explicit
   * blacklist observation, the 20-entry unique LRU `recentIpHistory`, and
   * rolling exact-IP reuse counts. Missing trusted IP omits every one of
   * these updates and leaves the profile's existing evidence untouched.
   */
  async #ipProfileFields(
    matched: UserIntelligenceDocument | null,
    input: {
      ip?: string;
      ipBlacklisted?: boolean;
      networkClassification?: GateSessionNetworkClassification;
      scope: BotBlockerScope;
      now: Date;
    },
    session: ClientSession,
  ): Promise<
    Pick<UserIntelligenceDocument, "currentIp" | "recentIpHistory" | "currentIpReuse">
  > {
    const incoming = buildIncomingIpEvidence(
      input.ip,
      input.ipBlacklisted,
      input.networkClassification,
    );
    const { currentIp, recentIpHistory } = updateIpEvidence(
      {
        currentIp: matched?.currentIp,
        recentIpHistory: matched?.recentIpHistory ?? [],
      },
      incoming,
    );
    const currentIpReuse = incoming
      ? await this.#reads.countIpReuse(
        incoming.ip,
        input.scope,
        input.now,
        session,
      )
      : matched?.currentIpReuse;
    return {
      recentIpHistory,
      ...(currentIp ? { currentIp } : {}),
      ...(currentIpReuse ? { currentIpReuse } : {}),
    };
  }
}

function initialReportSnapshot(
  input: Parameters<BotBlockerSessionPersistence["openGateSession"]>[0],
): CanonicalReportSnapshotDocument {
  return {
    report: input.initialReport,
    serverEvidence: {
      ...(input.ipBlacklisted !== undefined
        ? { ipBlacklisted: input.ipBlacklisted }
        : {}),
      ...(input.latestDecision ? { latestDecision: input.latestDecision } : {}),
      ...(input.networkClassification
        ? { networkClassification: input.networkClassification }
        : {}),
      ...(input.ipReputation ? { ipReputation: input.ipReputation } : {}),
    },
    serverObservedAt: input.now,
  };
}

function reportPageUrl(report: CanonicalReportRequest): string | undefined {
  const routePath = report.payload.behaviorReport?.evidence.routePath ??
    report.payload.browserEvidence?.routePath;
  if (!routePath) return undefined;
  try {
    return new URL(routePath, new URL(report.audience).origin).toString();
  } catch {
    return undefined;
  }
}

function fingerprintProfileFields(
  current: FingerprintVerifySource | undefined,
  vector: FingerprintVector,
  secret: string | undefined,
): Pick<
  UserIntelligenceDocument,
  "fingerprintVerifySource" | "fingerprintVerifyLookup"
> & Partial<Pick<
  UserIntelligenceDocument,
  | "osCpu"
  | "screenResolution"
  | "platform"
  | "touchSupport"
  | "vendor"
  | "architecture"
  | "applePay"
>> {
  const fingerprintVerifySource = {
    ...current,
    ...projectFingerprintVerifySource(vector),
  };
  return {
    ...projectDirectFingerprintFields(vector),
    fingerprintVerifySource,
    fingerprintVerifyLookup: deriveFingerprintVerifyLookup(
      fingerprintVerifySource,
      secret,
    ),
  };
}

/**
 * The only direct fingerprint values exposed on the hot profile row.
 * Unavailable components are omitted so an accepted newer vector cannot
 * erase the profile's last successful value.
 */
function projectDirectFingerprintFields(
  vector: FingerprintVector,
): Partial<Pick<
  UserIntelligenceDocument,
  | "osCpu"
  | "screenResolution"
  | "platform"
  | "touchSupport"
  | "vendor"
  | "architecture"
  | "applePay"
>> {
  const components = vector.components;
  const osCpu = availableComponent(components.osCpu);
  const screenResolution = availableComponent(components.screenResolution);
  const platform = availableComponent(components.platform);
  const touchSupport = availableComponent(components.touchSupport);
  const vendor = availableComponent(components.vendor);
  const architecture = availableComponent(components.architecture);
  const applePay = availableComponent(components.applePay);
  return {
    ...(osCpu !== undefined ? { osCpu } : {}),
    ...(screenResolution !== undefined ? { screenResolution } : {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(touchSupport !== undefined ? { touchSupport } : {}),
    ...(vendor !== undefined ? { vendor } : {}),
    ...(architecture !== undefined ? { architecture } : {}),
    ...(applePay !== undefined ? { applePay } : {}),
  };
}

function availableComponent<T>(
  component: { status: "available"; value: T } | { status: string } | undefined,
): T | undefined {
  return component?.status === "available" && "value" in component
    ? component.value
    : undefined;
}

function buildIncomingIpEvidence(
  ip: string | undefined,
  ipBlacklisted: boolean | undefined,
  networkClassification: GateSessionNetworkClassification | undefined,
): IpEvidence | undefined {
  if (ip === undefined || ipBlacklisted === undefined) return undefined;
  return {
    ip,
    blacklisted: ipBlacklisted,
    ...(networkClassification ? { asnScore: networkClassification.score } : {}),
  };
}

/**
 * Fixed, schema-driven current-IP/history synchronization (Phase 17A):
 * a same-IP observation refreshes `currentIp` in place without touching
 * history; an IP change removes any duplicate occurrence of both the
 * incoming and outgoing IP, moves the outgoing `currentIp` to the newest
 * history slot, and trims to the 20 most recent unique entries.
 * `asnScore` uses latest-successful replacement: an incoming session
 * without a resolved ASN score keeps the last known score for that exact
 * IP instead of discarding it.
 */
function updateIpEvidence(
  profile: { currentIp?: IpEvidence; recentIpHistory: IpEvidence[] },
  incoming: IpEvidence | undefined,
): { currentIp?: IpEvidence; recentIpHistory: IpEvidence[] } {
  if (!incoming) return profile;
  if (!profile.currentIp) {
    return { currentIp: incoming, recentIpHistory: profile.recentIpHistory };
  }
  if (profile.currentIp.ip === incoming.ip) {
    return {
      currentIp: withLatestAsnScore(incoming, profile.currentIp.asnScore),
      recentIpHistory: profile.recentIpHistory,
    };
  }
  const priorEntry = profile.recentIpHistory.find(
    (entry) => entry.ip === incoming.ip,
  );
  const remaining = profile.recentIpHistory.filter(
    (entry) => entry.ip !== incoming.ip && entry.ip !== profile.currentIp!.ip,
  );
  return {
    currentIp: withLatestAsnScore(incoming, priorEntry?.asnScore),
    recentIpHistory: [profile.currentIp, ...remaining].slice(0, 20),
  };
}

function withLatestAsnScore(
  incoming: IpEvidence,
  previousAsnScore: number | undefined,
): IpEvidence {
  const asnScore = incoming.asnScore ?? previousAsnScore;
  return {
    ip: incoming.ip,
    blacklisted: incoming.blacklisted,
    ...(asnScore !== undefined ? { asnScore } : {}),
  };
}
