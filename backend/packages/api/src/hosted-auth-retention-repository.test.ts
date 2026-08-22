import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Collection, Db } from "mongodb";

import {
  ensureHostedAuthRetentionIndexes,
  HOSTED_AUTH_RETENTION_COLLECTION_NAME,
  HOSTED_AUTH_RETENTION_DATABASE_NAME,
  hostedAuthRetentionDatabase,
  HostedAuthRetentionRepository,
  type HostedAuthRetentionDocument,
  type HostedAuthRetentionRecord,
} from "./hosted-auth-retention-repository.js";

const body = "A".repeat(43);
const createdAt = new Date("2026-08-22T01:00:00.000Z");
const completedAt = new Date("2026-08-22T01:01:00.000Z");
const retentionExpiresAt = new Date("2027-08-22T01:01:00.000Z");
const record = {
  authRequestId: `har_${body}`,
  projectId: "project_12345678",
  flow: "signup",
  method: "webauthn",
  bindingReference: `pib_${body}`,
  assuranceLevels: ["aal2"],
  verificationLevels: ["contact_verified"],
  outcome: "succeeded",
  correlationId: "correlation_123456",
  createdAt,
  completedAt,
  retentionExpiresAt,
} as const satisfies HostedAuthRetentionRecord;

class MemoryRetentionCollection {
  readonly documents = new Map<string, HostedAuthRetentionDocument>();
  readonly indexes: Array<{ keys: object; options: object }> = [];
  writeAttempts = 0;
  failWrites = false;

  async createIndex(keys: object, options: object) {
    this.indexes.push({ keys, options });
    return String(options);
  }

  async updateOne(
    filter: { _id: string },
    update: { $setOnInsert: HostedAuthRetentionDocument },
  ) {
    this.writeAttempts += 1;
    if (this.failWrites) throw new Error("retention unavailable");
    if (this.documents.has(filter._id)) {
      return { acknowledged: true, upsertedCount: 0 };
    }
    this.documents.set(filter._id, structuredClone(update.$setOnInsert));
    return { acknowledged: true, upsertedCount: 1 };
  }

  async findOne(filter: { _id: string }) {
    const document = this.documents.get(filter._id);
    return document ? structuredClone(document) : null;
  }
}

function repository(collection = new MemoryRetentionCollection()) {
  return {
    collection,
    repository: new HostedAuthRetentionRepository(
      {} as Db,
      collection as unknown as Collection<HostedAuthRetentionDocument>,
    ),
  };
}

describe("HostedAuthRetentionRepository", () => {
  it("uses a database isolated from both primary and hot runtime data", () => {
    const selected: string[] = [];
    const client = {
      db(name: string) {
        selected.push(name);
        return {} as Db;
      },
    };

    hostedAuthRetentionDatabase(client);

    assert.deepEqual(selected, [HOSTED_AUTH_RETENTION_DATABASE_NAME]);
    assert.notEqual(HOSTED_AUTH_RETENTION_DATABASE_NAME, "powerotp");
    assert.notEqual(HOSTED_AUTH_RETENTION_DATABASE_NAME, "powerotp_auth_runtime");
  });

  it("creates retention, support, and billing lookup indexes", async () => {
    const collection = new MemoryRetentionCollection();
    const db = {
      collection(name: string) {
        assert.equal(name, HOSTED_AUTH_RETENTION_COLLECTION_NAME);
        return collection;
      },
    } as unknown as Db;

    await ensureHostedAuthRetentionIndexes(db);

    assert.deepEqual(collection.indexes, [
      {
        keys: { retentionExpiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "retentionExpiresAt_ttl" },
      },
      {
        keys: { projectId: 1, completedAt: -1 },
        options: { name: "project_completed" },
      },
      {
        keys: { correlationId: 1 },
        options: { name: "correlation_lookup" },
      },
    ]);
  });

  it("persists only the canonical redacted record", async () => {
    const { repository: retention, collection } = repository();

    assert.equal(await retention.retain(record), "inserted");

    const stored = collection.documents.get(record.authRequestId);
    assert.deepEqual(stored, {
      _id: record.authRequestId,
      projectId: record.projectId,
      flow: record.flow,
      method: record.method,
      bindingReference: record.bindingReference,
      assuranceLevels: record.assuranceLevels,
      verificationLevels: record.verificationLevels,
      outcome: record.outcome,
      correlationId: record.correlationId,
      createdAt,
      completedAt,
      retentionExpiresAt,
    });
    assert.doesNotMatch(
      JSON.stringify(stored),
      /pollToken|browserHandle|email|providerSecret|clientResult/,
    );
  });

  it("rejects sensitive, unknown, and non-canonical fields", async () => {
    const { repository: retention, collection } = repository();
    const unsafe = {
      ...record,
      pollTokenHash: "secret",
      browserHandle: "browser-secret",
      completeClientResult: { projectUserId: "private" },
    } as unknown as HostedAuthRetentionRecord;

    await assert.rejects(retention.retain(unsafe));
    await assert.rejects(
      retention.retain({
        ...record,
        assuranceLevels: ["aal2", "aal2"],
      }),
    );
    assert.equal(collection.documents.size, 0);
  });

  it("is idempotent for exact duplicates and rejects conflicts", async () => {
    const { repository: retention, collection } = repository();

    assert.equal(await retention.retain(record), "inserted");
    assert.equal(await retention.retain(record), "duplicate");
    await assert.rejects(
      retention.retain({ ...record, method: "recovery_code" }),
      /Conflicting hosted-auth retention record/,
    );

    assert.equal(collection.documents.size, 1);
    assert.equal(collection.writeAttempts, 3);
  });

  it("propagates durable write failures", async () => {
    const { repository: retention, collection } = repository();
    collection.failWrites = true;

    await assert.rejects(retention.retain(record), /retention unavailable/);
    assert.equal(collection.documents.size, 0);
  });
});
