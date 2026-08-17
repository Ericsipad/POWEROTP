import type { BrowserEvidence } from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import {
  BotBlockerIntelligencePersistence,
  botBlockerMatchCutoff,
  botBlockerRetentionExpiresAt,
  createUserIntelligenceId,
  type BotBlockerScope,
  type GateSessionDocument,
  type IpObservation,
  type UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";

export class BotBlockerSessionPersistenceError extends Error {
  constructor(readonly code: "scope_mismatch" | "session_not_found") {
    super(code);
    this.name = "BotBlockerSessionPersistenceError";
  }
}

export class BotBlockerSessionPersistence {
  readonly #client: MongoClient;
  readonly #gateSessions;
  readonly #userIntelligence;
  readonly #reads: BotBlockerIntelligencePersistence;

  constructor(db: Db, client: MongoClient) {
    this.#client = client;
    this.#gateSessions = db.collection<GateSessionDocument>("gateSessions");
    this.#userIntelligence =
      db.collection<UserIntelligenceDocument>("userIntelligence");
    this.#reads = new BotBlockerIntelligencePersistence(db);
  }

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    return this.#reads.findGateSession(scope, gateSessionId);
  }

  async openGateSession(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    fingerprintHash: string;
    ip?: string;
    evidence: BrowserEvidence;
    now: Date;
  }): Promise<GateSessionDocument> {
    const userIntelligenceId = createUserIntelligenceId();
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
          result = existingById;
          return;
        }

        const matched = input.ip
          ? await this.#userIntelligence.findOne(
            {
              ...input.scope,
              fingerprintHash: input.fingerprintHash,
              "ipObservations.ip": input.ip,
              lastObservedAt: { $gte: botBlockerMatchCutoff(input.now) },
            },
            { session, sort: { lastObservedAt: -1 } },
          )
          : null;
        const userId = matched?._id ?? userIntelligenceId;
        if (matched) {
          await this.#userIntelligence.updateOne(
            { _id: matched._id, ...input.scope },
            {
              $set: {
                ipObservations: updateIpObservations(
                  matched.ipObservations,
                  input.ip,
                  input.now,
                ),
                latestEvidence: input.evidence,
                lastObservedAt: input.now,
                updatedAt: input.now,
                retentionExpiresAt: botBlockerRetentionExpiresAt(input.now),
              },
              $inc: { gateSessionCount: 1 },
            },
            { session },
          );
        } else {
          const intelligence: UserIntelligenceDocument = {
            _id: userId,
            ...input.scope,
            fingerprintHash: input.fingerprintHash,
            ipObservations: updateIpObservations([], input.ip, input.now),
            latestEvidence: input.evidence,
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
        }

        result = {
          _id: input.gateSessionId,
          ...input.scope,
          userIntelligenceId: userId,
          fingerprintHash: input.fingerprintHash,
          ...(input.ip ? { ip: input.ip } : {}),
          state: "active",
          lastAppliedSequence: -1,
          startedAt: input.now,
          lastObservedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
          retentionExpiresAt: botBlockerRetentionExpiresAt(input.now),
        };
        await this.#gateSessions.insertOne(result, { session });
      });
    });

    if (!result) {
      throw new BotBlockerSessionPersistenceError("session_not_found");
    }
    return result;
  }
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
