import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { NodeService } from "./node-service.js";
import type { NodeDocument } from "./persistence.js";

/**
 * A minimal fake standing in for the `nodes` collection — just enough of
 * MongoDB's driver surface for `NodeService`'s own methods, with calls
 * recorded for assertions. Real Mongo behavior (indexes, upsert semantics)
 * is exercised live, not re-implemented here.
 */
function createFakeDb(seed: NodeDocument[]) {
  const updateOneCalls: unknown[] = [];
  const fakeCollection = {
    updateOne: async (filter: unknown, update: unknown) => {
      updateOneCalls.push({ filter, update });
      return { matchedCount: seed.length > 0 ? 1 : 0 };
    },
    find: () => ({
      sort: () => ({
        toArray: async () => seed,
      }),
    }),
  };
  return {
    db: { collection: () => fakeCollection } as unknown as Db,
    updateOneCalls,
  };
}

const config = { NODE_SECRET: "test-node-secret" };

describe("NodeService.reportTrunkStatus", () => {
  it("stores the reported trunks and a fresh reportedAt timestamp, keyed by ip", async () => {
    const { db, updateOneCalls } = createFakeDb([
      { _id: "node_1", ip: "1.2.3.4", firstSeenAt: new Date(), lastSeenAt: new Date() },
    ]);
    const service = new NodeService(db, config as never);

    const trunks = [
      { id: "trunk-1", registrationState: "Registered" as const, healthy: true, consecutiveFailures: 0 },
      { id: "trunk-2", registrationState: "Rejected" as const, healthy: false, consecutiveFailures: 3, downUntil: Date.now() + 60_000 },
    ];
    await service.reportTrunkStatus("1.2.3.4", trunks);

    assert.equal(updateOneCalls.length, 1);
    const call = updateOneCalls[0] as { filter: { ip: string }; update: { $set: { trunkStatus: unknown; trunkStatusReportedAt: Date } } };
    assert.deepEqual(call.filter, { ip: "1.2.3.4" });
    assert.deepEqual(call.update.$set.trunkStatus, trunks);
    assert.ok(call.update.$set.trunkStatusReportedAt instanceof Date);
  });
});

describe("NodeService.list", () => {
  it("includes trunkStatus/trunkStatusReportedAt when present, serialized as ISO strings", async () => {
    const reportedAt = new Date("2026-08-08T20:00:00.000Z");
    const { db } = createFakeDb([
      {
        _id: "node_1",
        ip: "1.2.3.4",
        firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-08T20:01:00.000Z"),
        trunkStatus: [{ id: "trunk-1", registrationState: "Registered", healthy: true, consecutiveFailures: 0 }],
        trunkStatusReportedAt: reportedAt,
      },
    ]);
    const service = new NodeService(db, config as never);

    const [node] = await service.list();
    assert.equal(node!.trunkStatusReportedAt, reportedAt.toISOString());
    assert.deepEqual(node!.trunkStatus, [
      { id: "trunk-1", registrationState: "Registered", healthy: true, consecutiveFailures: 0 },
    ]);
  });

  it("omits trunkStatus fields entirely for a node that has never reported it", async () => {
    const { db } = createFakeDb([
      { _id: "node_1", ip: "1.2.3.4", firstSeenAt: new Date(), lastSeenAt: new Date() },
    ]);
    const service = new NodeService(db, config as never);

    const [node] = await service.list();
    assert.equal(node!.trunkStatus, undefined);
    assert.equal(node!.trunkStatusReportedAt, undefined);
  });
});
