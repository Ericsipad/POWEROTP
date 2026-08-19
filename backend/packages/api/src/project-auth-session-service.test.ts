import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import type { ProjectAuthSessionDocument } from "./accounting-persistence.js";
import {
  ProjectAuthSessionError,
  ProjectAuthSessionService,
} from "./project-auth-session-service.js";

function createService() {
  const rows: ProjectAuthSessionDocument[] = [];
  let adSystemActive = true;
  const collection = {
    findOne: async (filter: { projectId: string; idempotencyKey: string }) =>
      rows.find(
        (row) => row.projectId === filter.projectId && row.idempotencyKey === filter.idempotencyKey,
      ) ?? null,
    insertOne: async (document: ProjectAuthSessionDocument) => {
      if (rows.some((row) => row._id === document._id)) {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      }
      rows.push(document);
    },
    countDocuments: async (filter: { projectId: string; eventType: string }) =>
      rows.filter((row) => row.projectId === filter.projectId && row.eventType === filter.eventType).length,
  };
  return {
    service: new ProjectAuthSessionService({
      collection: (name: string) => name === "adSystems"
        ? {
            findOne: async () => adSystemActive ? { _id: "ads_one", active: true } : null,
          }
        : collection,
    } as unknown as Db),
    rows,
    deactivateAdSystem: () => {
      adSystemActive = false;
    },
  };
}

const input = {
  sessionId: "session_1234567890123456",
  eventType: "signup" as const,
  occurredAt: new Date().toISOString(),
  adSlotsAllotted: 2,
  adSlotsFilled: 1,
  adSystemId: "ads_one",
};

describe("ProjectAuthSessionService", () => {
  it("persists one immutable trusted report and replays it exactly", async () => {
    const { service, rows, deactivateAdSystem } = createService();
    const first = await service.report("prj_1", "usr_1", "idem_1", input);
    deactivateAdSystem();
    const replay = await service.report("prj_1", "usr_1", "idem_1", input);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(rows.length, 1);
  });

  it("rejects a new report for an unavailable ad system", async () => {
    const { service, deactivateAdSystem } = createService();
    deactivateAdSystem();
    await assert.rejects(
      () => service.report("prj_1", "usr_1", "idem_1", input),
      (error: unknown) =>
        error instanceof ProjectAuthSessionError && error.code === "ad_system_unavailable",
    );
  });

  it("rejects conflicting reuse of an idempotency key", async () => {
    const { service } = createService();
    await service.report("prj_1", "usr_1", "idem_1", input);
    await assert.rejects(
      () => service.report("prj_1", "usr_1", "idem_1", { ...input, adSlotsFilled: 2 }),
      (error: unknown) =>
        error instanceof ProjectAuthSessionError && error.code === "idempotency_conflict",
    );
  });

  it("rejects reports older than the accounting lookback", async () => {
    const { service } = createService();
    await assert.rejects(
      () => service.report("prj_1", "usr_1", "idem_1", {
        ...input,
        occurredAt: new Date(Date.now() - 32 * 86_400_000).toISOString(),
      }),
      (error: unknown) =>
        error instanceof ProjectAuthSessionError && error.code === "event_timestamp_out_of_range",
    );
  });
});
