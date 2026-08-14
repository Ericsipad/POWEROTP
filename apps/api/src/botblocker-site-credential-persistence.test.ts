import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";

import {
  BotBlockerSiteCredentialPersistence,
  ensureBotBlockerSiteCredentialIndexes,
  type BotBlockerSiteCredentialDocument,
} from "./botblocker-site-credential-persistence.js";

function transactionClient(): MongoClient {
  return {
    withSession: async (
      callback: (session: {
        withTransaction: (work: () => Promise<void>) => Promise<void>;
      }) => Promise<void>,
    ) => callback({ withTransaction: async (work) => work() }),
  } as unknown as MongoClient;
}

describe("BotBlockerSiteCredentialPersistence", () => {
  it("creates unique hash, active-site, rotation-idempotency, and scope indexes", async () => {
    const indexes: Array<{
      keys: Record<string, number>;
      options?: Record<string, unknown>;
    }> = [];
    const db = {
      collection: () => ({
        createIndex: async (
          keys: Record<string, number>,
          options?: Record<string, unknown>,
        ) => {
          indexes.push({ keys, options });
        },
      }),
    } as unknown as Db;
    await ensureBotBlockerSiteCredentialIndexes(db);
    assert.equal(indexes.length, 4);
    assert.ok(
      indexes.some(
        (index) =>
          index.keys.credentialHash === 1 && index.options?.unique === true,
      ),
    );
    assert.ok(
      indexes.some(
        (index) =>
          index.keys.siteId === 1 &&
          index.options?.unique === true &&
          index.options.partialFilterExpression !== undefined,
      ),
    );
  });

  it("revokes the prior active credential in the same transaction before insertion", async () => {
    const documents: BotBlockerSiteCredentialDocument[] = [
      {
        _id: "bbk_old_1234567890123456",
        customerId: "usr_owner",
        projectId: "prj_1234567890123456",
        siteId: "bbs_1234567890123456",
        credentialHash: "old_hash",
        rotationKeyHash: "old_rotation",
        prefix: "potp_bb_old",
        lastFour: "old1",
        createdAt: new Date(1),
      },
    ];
    const db = {
      collection: () => ({
        updateMany: async (
          filter: Record<string, unknown>,
          update: { $set: { revokedAt: Date } },
        ) => {
          for (const document of documents) {
            if (
              document.siteId === filter.siteId &&
              document.revokedAt === undefined
            ) {
              document.revokedAt = update.$set.revokedAt;
            }
          }
        },
        insertOne: async (document: BotBlockerSiteCredentialDocument) => {
          documents.push(document);
        },
      }),
    } as unknown as Db;
    const persistence = new BotBlockerSiteCredentialPersistence(
      db,
      transactionClient(),
    );
    const created = await persistence.rotate(
      {
        customerId: "usr_owner",
        projectId: "prj_1234567890123456",
        siteId: "bbs_1234567890123456",
      },
      {
        credentialHash: "new_hash",
        rotationKeyHash: "new_rotation",
        prefix: "potp_bb_new",
        lastFour: "new1",
      },
      new Date(2),
    );
    assert.equal(documents[0]?.revokedAt?.getTime(), 2);
    assert.equal(created.credentialHash, "new_hash");
    assert.equal(documents.length, 2);
  });
});
