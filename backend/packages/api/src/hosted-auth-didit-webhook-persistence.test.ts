import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db, MongoClient } from "mongodb";

import {
  HOSTED_AUTH_DIDIT_WEBHOOK_CURSOR_COLLECTION,
  HOSTED_AUTH_DIDIT_WEBHOOK_EVENT_COLLECTION,
  MongoHostedAuthDiditWebhookRepository,
} from "./hosted-auth-didit-webhook-persistence.js";
import {
  HostedAuthDiditWebhookError,
  type HostedAuthDiditWebhookEvent,
} from "./hosted-auth-didit-webhook.js";

class MemoryCollection {
  readonly documents = new Map<string, Record<string, unknown>>();

  async findOne(filter: { _id: string }) {
    return structuredClone(this.documents.get(filter._id) ?? null);
  }

  async insertOne(document: Record<string, unknown>) {
    this.documents.set(String(document._id), structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }

  async updateOne(
    filter: { _id: string },
    update: { $set: Record<string, unknown> },
  ) {
    this.documents.set(filter._id, {
      ...(this.documents.get(filter._id) ?? { _id: filter._id }),
      ...structuredClone(update.$set),
    });
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }
}

function state() {
  const events = new MemoryCollection();
  const cursors = new MemoryCollection();
  const db = {
    collection(name: string) {
      return name === HOSTED_AUTH_DIDIT_WEBHOOK_EVENT_COLLECTION
        ? events
        : cursors;
    },
  } as unknown as Db;
  const client = {
    startSession() {
      return {
        async withTransaction(work: () => Promise<void>) {
          await work();
        },
        async endSession() {},
      };
    },
  } as unknown as Pick<MongoClient, "startSession">;
  return {
    events,
    cursors,
    db,
    repository: new MongoHostedAuthDiditWebhookRepository(db, client),
  };
}

function event(
  overrides: Partial<HostedAuthDiditWebhookEvent> = {},
): HostedAuthDiditWebhookEvent {
  return {
    eventId: "9c0c8b8a-1111-4222-9333-444444444444",
    eventType: "status.updated",
    applicationId: "11111111-2222-4333-8444-555555555555",
    environment: "live",
    providerOperationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    potpDiditId: `pdi_${"A".repeat(43)}`,
    status: "Approved",
    providerCreatedAt: new Date("2026-08-22T07:59:55.000Z"),
    receivedAt: new Date("2026-08-22T08:00:00.000Z"),
    payloadDigest: "digest-one",
    ...overrides,
  };
}

describe("hosted-auth Didit webhook persistence", () => {
  it("deduplicates exact events and rejects changed reuse of an event ID", async () => {
    const { repository, events } = state();
    assert.equal(await repository.record(event()), "accepted");
    assert.equal(await repository.record(event()), "replayed");
    assert.equal(events.documents.size, 1);
    await assert.rejects(
      repository.record(event({ payloadDigest: "digest-two" })),
      (error) =>
        error instanceof HostedAuthDiditWebhookError &&
        error.code === "conflicting_replay",
    );
  });

  it("records stale events without regressing the latest session cursor", async () => {
    const { repository, events, cursors } = state();
    const current = event();
    await repository.record(current);
    const stale = event({
      eventId: "2c0c8b8a-1111-4222-9333-444444444444",
      providerCreatedAt: new Date(current.providerCreatedAt.getTime() - 1),
      payloadDigest: "digest-stale",
      status: "In Progress",
    });
    assert.equal(await repository.record(stale), "stale");
    assert.equal(events.documents.size, 2);
    assert.equal(
      cursors.documents.get(current.providerOperationId)?.status,
      "Approved",
    );
  });
});
