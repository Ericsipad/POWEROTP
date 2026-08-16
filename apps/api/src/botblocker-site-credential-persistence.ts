import type { Db, MongoClient } from "mongodb";

import { createId } from "./security.js";

export interface BotBlockerSiteCredentialDocument {
  _id: string;
  customerId: string;
  projectId: string;
  siteId: string;
  credentialHash: string;
  rotationKeyHash: string;
  prefix: string;
  lastFour: string;
  createdAt: Date;
  revokedAt?: Date;
  /**
   * Present (always `true`) while the credential is active, and removed on
   * revocation. MongoDB partial indexes don't support `$exists: false` /
   * `$not`, so the unique "one active credential per site" index must key
   * off a field's presence rather than `revokedAt`'s absence.
   */
  active?: true;
}

export async function ensureBotBlockerSiteCredentialIndexes(
  db: Db,
): Promise<void> {
  const credentials = db.collection<BotBlockerSiteCredentialDocument>(
    "botblockerSiteCredentials",
  );
  await Promise.all([
    credentials.createIndex({ credentialHash: 1 }, { unique: true }),
    credentials.createIndex(
      { siteId: 1 },
      {
        unique: true,
        partialFilterExpression: { active: true },
      },
    ),
    credentials.createIndex({
      customerId: 1,
      projectId: 1,
      siteId: 1,
      createdAt: -1,
    }),
    credentials.createIndex(
      { customerId: 1, projectId: 1, rotationKeyHash: 1 },
      { unique: true },
    ),
  ]);
}

export class BotBlockerSiteCredentialPersistence {
  readonly #client: MongoClient;
  readonly #credentials;

  constructor(db: Db, client: MongoClient) {
    this.#client = client;
    this.#credentials = db.collection<BotBlockerSiteCredentialDocument>(
      "botblockerSiteCredentials",
    );
  }

  findActiveByHash(credentialHash: string) {
    return this.#credentials.findOne({
      credentialHash,
      active: true,
    });
  }

  findByRotationKey(
    scope: { customerId: string; projectId: string },
    rotationKeyHash: string,
  ) {
    return this.#credentials.findOne({ ...scope, rotationKeyHash });
  }

  async rotate(
    scope: { customerId: string; projectId: string; siteId: string },
    value: {
      credentialHash: string;
      rotationKeyHash: string;
      prefix: string;
      lastFour: string;
    },
    now: Date,
  ): Promise<BotBlockerSiteCredentialDocument> {
    const document: BotBlockerSiteCredentialDocument = {
      _id: createId("bbk"),
      ...scope,
      ...value,
      createdAt: now,
      active: true,
    };
    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await this.#credentials.updateMany(
          { ...scope, active: true },
          { $set: { revokedAt: now }, $unset: { active: "" } },
          { session },
        );
        await this.#credentials.insertOne(document, { session });
      });
    });
    return document;
  }
}
