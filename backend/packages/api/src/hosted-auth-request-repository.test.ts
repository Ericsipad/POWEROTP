import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedAuthRealms } from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

import {
  ensureHostedAuthRequestIndexes,
  HOSTED_AUTH_REQUEST_COLLECTION_NAME,
  HostedAuthRequestRepository,
  type HostedAuthRequestDocument,
} from "./hosted-auth-request-repository.js";

const body = "A".repeat(43);
const authRequestId = `har_${body}`;
const pollToken = `hpt_${body}`;
const scope = {
  projectId: "project_12345678",
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup" as const,
};

class MemoryCollection {
  readonly documents = new Map<string, HostedAuthRequestDocument>();
  readonly indexes: Array<{ keys: object; options: object }> = [];

  async createIndex(keys: object, options: object) {
    this.indexes.push({ keys, options });
    return String(options);
  }

  async insertOne(document: HostedAuthRequestDocument) {
    this.documents.set(document._id, structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }

  async findOne(filter: Record<string, unknown>) {
    const document = this.documents.get(String(filter._id));
    if (
      !document ||
      (filter["scope.projectId"] !== undefined &&
        document.scope.projectId !== filter["scope.projectId"]) ||
      (filter["scope.flow"] !== undefined &&
        document.scope.flow !== filter["scope.flow"])
    ) {
      return null;
    }
    return structuredClone(document);
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Partial<HostedAuthRequestDocument> },
  ) {
    const document = this.documents.get(String(filter._id));
    const expiresAt = filter.expiresAt as { $gt?: Date } | undefined;
    const terminal = ["succeeded", "failed", "canceled", "expired"];
    if (
      !document ||
      document.scope.projectId !== filter["scope.projectId"] ||
      terminal.includes(document.state) ||
      (expiresAt?.$gt && document.expiresAt <= expiresAt.$gt)
    ) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }
    this.documents.set(document._id, { ...document, ...update.$set });
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter: Record<string, unknown>) {
    const document = this.documents.get(String(filter._id));
    if (
      document &&
      (!(filter.purgeAt instanceof Date) ||
        filter.purgeAt.getTime() === document.purgeAt.getTime())
    ) {
      this.documents.delete(document._id);
      return { acknowledged: true, deletedCount: 1 };
    }
    return { acknowledged: true, deletedCount: 0 };
  }
}

function repository(collection = new MemoryCollection()) {
  return {
    collection,
    repository: new HostedAuthRequestRepository(
      {} as Db,
      "result-encryption-key".repeat(2),
      collection as unknown as Collection<HostedAuthRequestDocument>,
    ),
  };
}

describe("HostedAuthRequestRepository", () => {
  it("creates the dedicated exact-date TTL and scoped lookup indexes", async () => {
    const collection = new MemoryCollection();
    const db = {
      collection(name: string) {
        assert.equal(name, HOSTED_AUTH_REQUEST_COLLECTION_NAME);
        return collection;
      },
    } as unknown as Db;

    await ensureHostedAuthRequestIndexes(db);

    assert.deepEqual(collection.indexes, [
      {
        keys: { purgeAt: 1 },
        options: { expireAfterSeconds: 0, name: "purgeAt_ttl" },
      },
      {
        keys: { "scope.projectId": 1, _id: 1 },
        options: { name: "project_request" },
      },
    ]);
  });

  it("enforces the default and exact active-TTL boundaries", async () => {
    const createdAt = new Date("2026-08-21T23:00:00.000Z");
    const { repository: requests, collection } = repository();
    const created = await requests.create({
      authRequestId,
      scope,
      pollToken,
      createdAt,
    });

    assert.equal(created.expiresAt.getTime(), createdAt.getTime() + 1_800_000);
    assert.equal(
      (
        await requests.poll({
          authRequestId,
          projectId: scope.projectId,
          flow: scope.flow,
          pollToken,
          now: new Date(created.expiresAt.getTime() - 1),
        })
      ).outcome,
      "active",
    );
    assert.equal(
      (
        await requests.poll({
          authRequestId,
          projectId: scope.projectId,
          flow: scope.flow,
          pollToken,
          now: created.expiresAt,
        })
      ).outcome,
      "expired",
    );
    assert.equal(collection.documents.size, 0);
  });

  it("accepts only the 300 through 86,400 second active TTL range", async () => {
    for (const requestExpiresInSeconds of [300, 86_400]) {
      const { repository: requests } = repository();
      await assert.doesNotReject(
        requests.create({
          authRequestId,
          scope,
          pollToken,
          requestExpiresInSeconds,
        }),
      );
    }
    for (const requestExpiresInSeconds of [299, 86_401]) {
      const { repository: requests } = repository();
      await assert.rejects(
        requests.create({
          authRequestId,
          scope,
          pollToken,
          requestExpiresInSeconds,
        }),
      );
    }
  });

  it("persists only the poll-token hash and verifies project, flow, and token", async () => {
    const { repository: requests, collection } = repository();
    await requests.create({ authRequestId, scope, pollToken });
    const stored = collection.documents.get(authRequestId);

    assert.ok(stored);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(pollToken));
    assert.notEqual(stored.pollTokenHash, pollToken);
    assert.equal(
      (
        await requests.poll({
          authRequestId,
          projectId: scope.projectId,
          flow: scope.flow,
          pollToken: `hpt_${"E".repeat(43)}`,
        })
      ).outcome,
      "invalid_poll_token",
    );
    assert.equal(
      (
        await requests.poll({
          authRequestId,
          projectId: "another_project_123",
          flow: scope.flow,
          pollToken,
        })
      ).outcome,
      "not_found",
    );
  });

  it("encrypts a terminal result and exposes it for exactly three minutes", async () => {
    const createdAt = new Date("2026-08-21T23:00:00.000Z");
    const completedAt = new Date(createdAt.getTime() + 60_000);
    const result = { projectUserId: `pusr_${body}`, assuranceMethods: ["webauthn"] };
    const { repository: requests, collection } = repository();
    await requests.create({ authRequestId, scope, pollToken, createdAt });

    assert.equal(
      await requests.publishTerminal({
        authRequestId,
        projectId: scope.projectId,
        state: "succeeded",
        completedAt,
        result,
      }),
      true,
    );
    const stored = collection.documents.get(authRequestId);
    assert.ok(stored?.terminalResultEncrypted);
    assert.doesNotMatch(JSON.stringify(stored), /projectUserId|pusr_/);
    assert.equal(stored.resultExpiresAt?.getTime(), completedAt.getTime() + 180_000);
    assert.equal(stored.purgeAt.getTime(), completedAt.getTime() + 180_000);

    const available = await requests.poll({
      authRequestId,
      projectId: scope.projectId,
      flow: scope.flow,
      pollToken,
      now: new Date(completedAt.getTime() + 179_999),
    });
    assert.equal(available.outcome, "terminal");
    if (available.outcome === "terminal") assert.deepEqual(available.result, result);

    assert.equal(
      (
        await requests.poll({
          authRequestId,
          projectId: scope.projectId,
          flow: scope.flow,
          pollToken,
          now: new Date(completedAt.getTime() + 180_000),
        })
      ).outcome,
      "expired",
    );
    assert.equal(collection.documents.size, 0);
  });

  it("cannot replace a terminal result or publish after active expiry", async () => {
    const createdAt = new Date("2026-08-21T23:00:00.000Z");
    const { repository: requests } = repository();
    await requests.create({
      authRequestId,
      scope,
      pollToken,
      requestExpiresInSeconds: 300,
      createdAt,
    });
    const first = {
      authRequestId,
      projectId: scope.projectId,
      state: "failed" as const,
      completedAt: new Date(createdAt.getTime() + 1_000),
      result: { failureReason: "authentication_failed" },
    };
    assert.equal(await requests.publishTerminal(first), true);
    assert.equal(
      await requests.publishTerminal({ ...first, state: "succeeded", result: {} }),
      false,
    );

    const second = repository().repository;
    await second.create({
      authRequestId,
      scope,
      pollToken,
      requestExpiresInSeconds: 300,
      createdAt,
    });
    assert.equal(
      await second.publishTerminal({
        ...first,
        completedAt: new Date(createdAt.getTime() + 300_000),
      }),
      false,
    );
  });
});
