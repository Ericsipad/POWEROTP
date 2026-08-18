import { isDeepStrictEqual } from "node:util";

import type {
  FingerprintComponents,
  FingerprintVector,
} from "@powerotp/contracts";
import type { ClientSession, Db } from "mongodb";

import {
  botBlockerRetentionExpiresAt,
  type BotBlockerScope,
} from "./botblocker-intelligence-persistence.js";

export interface FingerprintDataDocument extends BotBlockerScope {
  _id: string;
  userIntelligenceId: string;
  sourceGateSessionId: string;
  fingerprintVersion: FingerprintVector["fingerprintVersion"];
  collectorVersion: FingerprintVector["collectorVersion"];
  components: FingerprintComponents;
  serverObservedAt: Date;
  firstObservedAt: Date;
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export type FingerprintWriteOutcome = "accepted" | "duplicate" | "stale";

export class FingerprintPersistenceError extends Error {
  constructor(readonly code: "scope_mismatch" | "conflicting_replay") {
    super(code);
    this.name = "FingerprintPersistenceError";
  }
}

export async function ensureFingerprintDataIndexes(db: Db): Promise<void> {
  const collection = db.collection<FingerprintDataDocument>("fingerprintData");
  await Promise.all([
    collection.createIndex({ userIntelligenceId: 1 }, { unique: true }),
    collection.createIndex({
      customerId: 1,
      projectId: 1,
      siteId: 1,
      fingerprintVersion: 1,
      collectorVersion: 1,
    }),
    collection.createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
  ]);
}

export class FingerprintPersistence {
  readonly #fingerprints;

  constructor(db: Db) {
    this.#fingerprints =
      db.collection<FingerprintDataDocument>("fingerprintData");
  }

  findByProfile(
    scope: BotBlockerScope,
    userIntelligenceId: string,
    session?: ClientSession,
  ) {
    return this.#fingerprints.findOne(
      { _id: userIntelligenceId, ...scope },
      session ? { session } : undefined,
    );
  }

  findExactVector(
    scope: BotBlockerScope,
    vector: FingerprintVector,
    session: ClientSession,
  ) {
    return this.#fingerprints.findOne(
      {
        ...scope,
        fingerprintVersion: vector.fingerprintVersion,
        collectorVersion: vector.collectorVersion,
        components: vector.components,
      },
      {
        session,
        sort: { serverObservedAt: -1, sourceGateSessionId: -1 },
      },
    );
  }

  async writeCurrent(
    input: {
      scope: BotBlockerScope;
      userIntelligenceId: string;
      gateSessionId: string;
      vector: FingerprintVector;
      observedAt: Date;
    },
    session: ClientSession,
  ): Promise<{
    outcome: FingerprintWriteOutcome;
    document: FingerprintDataDocument;
  }> {
    const existing = await this.#fingerprints.findOne(
      { _id: input.userIntelligenceId },
      { session },
    );
    if (existing && !sameScope(existing, input.scope)) {
      throw new FingerprintPersistenceError("scope_mismatch");
    }

    if (existing) {
      const order = compareObservation(
        input.observedAt,
        input.gateSessionId,
        existing.serverObservedAt,
        existing.sourceGateSessionId,
      );
      if (order < 0) return { outcome: "stale", document: existing };
      if (order === 0) {
        if (
          existing.fingerprintVersion === input.vector.fingerprintVersion &&
          existing.collectorVersion === input.vector.collectorVersion &&
          isDeepStrictEqual(existing.components, input.vector.components)
        ) {
          return { outcome: "duplicate", document: existing };
        }
        throw new FingerprintPersistenceError("conflicting_replay");
      }
    }

    const document: FingerprintDataDocument = {
      _id: input.userIntelligenceId,
      ...input.scope,
      userIntelligenceId: input.userIntelligenceId,
      sourceGateSessionId: input.gateSessionId,
      fingerprintVersion: input.vector.fingerprintVersion,
      collectorVersion: input.vector.collectorVersion,
      components: input.vector.components,
      serverObservedAt: input.observedAt,
      firstObservedAt: existing?.firstObservedAt ?? input.observedAt,
      lastObservedAt: input.observedAt,
      createdAt: existing?.createdAt ?? input.observedAt,
      updatedAt: input.observedAt,
      retentionExpiresAt: botBlockerRetentionExpiresAt(input.observedAt),
    };

    if (existing) {
      await this.#fingerprints.replaceOne(
        {
          _id: input.userIntelligenceId,
          ...input.scope,
          serverObservedAt: existing.serverObservedAt,
          sourceGateSessionId: existing.sourceGateSessionId,
        },
        document,
        { session },
      );
    } else {
      await this.#fingerprints.insertOne(document, { session });
    }
    return { outcome: "accepted", document };
  }
}

function compareObservation(
  leftTime: Date,
  leftSessionId: string,
  rightTime: Date,
  rightSessionId: string,
): number {
  const timeOrder = leftTime.getTime() - rightTime.getTime();
  return timeOrder === 0 ? leftSessionId.localeCompare(rightSessionId) : timeOrder;
}

function sameScope(
  document: BotBlockerScope,
  scope: BotBlockerScope,
): boolean {
  return document.customerId === scope.customerId &&
    document.projectId === scope.projectId &&
    document.siteId === scope.siteId;
}
