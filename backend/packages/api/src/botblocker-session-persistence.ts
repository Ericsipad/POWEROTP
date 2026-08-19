import { isDeepStrictEqual } from "node:util";

import type {
  BotBlockerDecisionOutcome,
  FingerprintVector,
  FingerprintVerifySource,
  RapidAuthRequest,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

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
  type BotBlockerScope,
  type DurableRiskEventDocument,
  type GateSessionDocument,
  type GateSessionIpReputation,
  type GateSessionNetworkClassification,
  type InitialRequestEventDocument,
  type InitialSessionRequestSnapshotDocument,
  type IpObservation,
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

  constructor(db: Db, client: MongoClient) {
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
    initialRequest: RapidAuthRequest;
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
    const fingerprint = input.initialRequest.payload.browser.fingerprint;
    const evidence = input.initialRequest.payload.browser.evidence;
    const initialRequest = initialRequestSnapshot(input);
    let result: GateSessionDocument | undefined;

    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const existingById = await this.#gateSessions.findOne(
          { _id: input.gateSessionId },
          { session },
        );
        if (existingById) {
          if (!sameScope(existingById, input.scope)) {
            throw new BotBlockerSessionPersistenceError("scope_mismatch");
          }
          if (
            isDeepStrictEqual(
              existingById.initialRequest.request,
              input.initialRequest,
            ) &&
            existingById.ip === input.ip
          ) {
            result = existingById;
            return;
          }
          throw new BotBlockerSessionPersistenceError(
            input.initialRequest.issuedAt <=
                existingById.initialRequest.request.issuedAt
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
          if (!sameScope(bound, input.scope)) {
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
          initialRequest,
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

        const occurredAt = new Date(input.initialRequest.issuedAt);
        const initialEvent: InitialRequestEventDocument = {
          _id: createRiskEventId(),
          ...input.scope,
          userIntelligenceId: userId,
          gateSessionId: input.gateSessionId,
          reportSequence: -1,
          eventIndex: 0,
          recordType: "initial_request",
          initialRequest,
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
        if (!matched) {
          const intelligence: UserIntelligenceDocument = {
            _id: userId,
            ...input.scope,
            ...fingerprintProfile,
            ipObservations: updateIpObservations([], input.ip, input.now),
            latestEvidence: evidence,
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
                ipObservations: updateIpObservations(
                  matched.ipObservations,
                  input.ip,
                  input.now,
                ),
                latestEvidence: evidence,
                lastObservedAt: input.now,
                updatedAt: input.now,
                retentionExpiresAt: botBlockerRetentionExpiresAt(input.now),
                ...fingerprintProfile,
              },
              $inc: { gateSessionCount: 1 },
            },
            { session },
          );
        }

      });
    });

    if (!result) {
      throw new BotBlockerSessionPersistenceError("session_not_found");
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
          visitorToken: input.metadata,
          updatedAt: input.now,
        },
      },
    );
    if (update.matchedCount !== 1) {
      throw new BotBlockerSessionPersistenceError("session_not_found");
    }
  }
}

function initialRequestSnapshot(
  input: Parameters<BotBlockerSessionPersistence["openGateSession"]>[0],
): InitialSessionRequestSnapshotDocument {
  return {
    request: input.initialRequest,
    risk: {
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

function fingerprintProfileFields(
  current: FingerprintVerifySource | undefined,
  vector: FingerprintVector,
  secret: string | undefined,
): Pick<
  UserIntelligenceDocument,
  "fingerprintVerifySource" | "fingerprintVerifyLookup"
> {
  const fingerprintVerifySource = {
    ...current,
    ...projectFingerprintVerifySource(vector),
  };
  return {
    fingerprintVerifySource,
    fingerprintVerifyLookup: deriveFingerprintVerifyLookup(
      fingerprintVerifySource,
      secret,
    ),
  };
}

function sameScope(
  document: BotBlockerScope,
  scope: BotBlockerScope,
): boolean {
  return document.customerId === scope.customerId &&
    document.projectId === scope.projectId &&
    document.siteId === scope.siteId;
}

function updateIpObservations(
  current: IpObservation[],
  ip: string | undefined,
  now: Date,
): IpObservation[] {
  if (!ip) return current;
  const existing = current.find((observation) => observation.ip === ip);
  if (!existing) {
    return [
      ...current,
      {
        ip,
        firstObservedAt: now,
        lastObservedAt: now,
        observationCount: 1,
      },
    ];
  }
  return current.map((observation) =>
    observation.ip === ip
      ? {
          ...observation,
          lastObservedAt: now,
          observationCount: observation.observationCount + 1,
        }
      : observation
  );
}
