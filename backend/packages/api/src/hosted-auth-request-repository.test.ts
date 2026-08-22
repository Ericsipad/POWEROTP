import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  ensureHostedAuthRequestIndexes,
  HOSTED_AUTH_REQUEST_COLLECTION_NAME,
} from "./hosted-auth-request-repository.js";
import {
  authRequestId,
  body,
  MemoryHostedAuthRequestCollection,
  MemoryHostedAuthRetentionWriter,
  pollToken,
  requestRepository,
  scope,
  successRetention,
} from "./hosted-auth-request-repository.test-support.js";

describe("HostedAuthRequestRepository", () => {
  it("creates the dedicated exact-date TTL and scoped lookup indexes", async () => {
    const collection = new MemoryHostedAuthRequestCollection();
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

  it("enforces the fixed ten-minute active-TTL boundary", async () => {
    const createdAt = new Date("2026-08-21T23:00:00.000Z");
    const { repository: requests, collection } = requestRepository();
    const created = await requests.create({
      authRequestId,
      scope,
      pollToken,
      createdAt,
    });

    assert.equal(created.expiresAt.getTime(), createdAt.getTime() + 600_000);
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

  it("persists only the poll-token hash and verifies project, flow, and token", async () => {
    const { repository: requests, collection } = requestRepository();
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
    const { repository: requests, collection } = requestRepository();
    await requests.create({ authRequestId, scope, pollToken, createdAt });

    assert.equal(
      await requests.publishTerminal({
        authRequestId,
        projectId: scope.projectId,
        state: "succeeded",
        completedAt,
        result,
        retention: successRetention,
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
    const { repository: requests } = requestRepository();
    await requests.create({
      authRequestId,
      scope,
      pollToken,
      createdAt,
    });
    const first = {
      authRequestId,
      projectId: scope.projectId,
      state: "failed" as const,
      completedAt: new Date(createdAt.getTime() + 1_000),
      result: { failureReason: "authentication_failed" },
      retention: {
        ...successRetention,
        failureReason: "authentication_failed" as const,
      },
    };
    assert.equal(await requests.publishTerminal(first), true);
    assert.equal(
      await requests.publishTerminal({ ...first, state: "succeeded", result: {} }),
      false,
    );

    const second = requestRepository().repository;
    await second.create({
      authRequestId,
      scope,
      pollToken,
      createdAt,
    });
    assert.equal(
      await second.publishTerminal({
        ...first,
        completedAt: new Date(createdAt.getTime() + 600_000),
      }),
      false,
    );
  });

  it("writes durable retention before publishing a terminal result", async () => {
    const events: string[] = [];
    const collection = new MemoryHostedAuthRequestCollection(events);
    const retention = new MemoryHostedAuthRetentionWriter(events);
    const { repository: requests } = requestRepository(collection, retention);
    const createdAt = new Date("2026-08-22T01:00:00.000Z");
    await requests.create({ authRequestId, scope, pollToken, createdAt });

    assert.equal(
      await requests.publishTerminal({
        authRequestId,
        projectId: scope.projectId,
        state: "succeeded",
        completedAt: new Date(createdAt.getTime() + 1_000),
        result: { projectUserId: `pusr_${body}` },
        retention: successRetention,
      }),
      true,
    );
    assert.deepEqual(events, ["retain", "publish"]);
    assert.equal(retention.records[0]?.flow, scope.flow);
    assert.equal(retention.records[0]?.createdAt.getTime(), createdAt.getTime());
  });

  it("does not publish when durable retention fails", async () => {
    const events: string[] = [];
    const collection = new MemoryHostedAuthRequestCollection(events);
    const retention = new MemoryHostedAuthRetentionWriter(
      events,
      new Error("retention unavailable"),
    );
    const { repository: requests } = requestRepository(collection, retention);
    const createdAt = new Date("2026-08-22T01:00:00.000Z");
    await requests.create({ authRequestId, scope, pollToken, createdAt });

    await assert.rejects(
      requests.publishTerminal({
        authRequestId,
        projectId: scope.projectId,
        state: "succeeded",
        completedAt: new Date(createdAt.getTime() + 1_000),
        result: { projectUserId: `pusr_${body}` },
        retention: successRetention,
      }),
      /retention unavailable/,
    );
    assert.deepEqual(events, ["retain"]);
    assert.equal(collection.documents.get(authRequestId)?.state, "created");
  });
});
