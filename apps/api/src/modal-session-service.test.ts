import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { MODAL_SESSION_MAX_ATTEMPTS, ModalSessionError, ModalSessionService } from "./modal-session-service.js";
import type { ModalSessionDocument } from "./modal-session-persistence.js";

/**
 * A minimal fake standing in for the `modalSessions` collection, matching
 * the same convention already used in `node-service.test.ts` — just enough
 * of the driver surface for `ModalSessionService`'s own methods.
 */
function createFakeDb(seed?: ModalSessionDocument) {
  let stored = seed;
  const insertedDocs: ModalSessionDocument[] = [];
  const fakeCollection = {
    insertOne: async (document: ModalSessionDocument) => {
      stored = document;
      insertedDocs.push(document);
      return { insertedId: document._id };
    },
    findOne: async (filter: { _id: string }) =>
      stored && stored._id === filter._id ? stored : null,
    findOneAndUpdate: async (
      filter: { _id: string; attempts: number },
      update: { $inc: { attempts: number } },
    ) => {
      if (!stored || stored._id !== filter._id || stored.attempts !== filter.attempts) {
        return null;
      }
      stored = { ...stored, attempts: stored.attempts + update.$inc.attempts };
      return stored;
    },
  };
  return {
    db: { collection: () => fakeCollection } as unknown as Db,
    insertedDocs,
  };
}

const project: { _id: string; customerId: string; enabledMethods: ("call_reachability" | "voice_code" | "sms_code")[] } = {
  _id: "prj_1",
  customerId: "cus_1",
  enabledMethods: ["call_reachability", "voice_code", "sms_code"],
};

describe("ModalSessionService.createSession", () => {
  it("defaults allowedTypes to every method the project has enabled", async () => {
    const { db, insertedDocs } = createFakeDb();
    const service = new ModalSessionService(db);

    const session = await service.createSession(project, undefined);
    assert.deepEqual(session.allowedTypes, [...project.enabledMethods]);
    assert.equal(session.attempts, 0);
    assert.equal(session.maxAttempts, MODAL_SESSION_MAX_ATTEMPTS);
    assert.equal(insertedDocs.length, 1);
  });

  it("accepts a requested subset of the project's enabled methods", async () => {
    const { db } = createFakeDb();
    const service = new ModalSessionService(db);

    const session = await service.createSession(project, ["sms_code"]);
    assert.deepEqual(session.allowedTypes, ["sms_code"]);
  });

  it("rejects a requested type the project has not enabled", async () => {
    const { db } = createFakeDb();
    const service = new ModalSessionService(db);

    await assert.rejects(
      () => service.createSession(project, ["voice_challenge"]),
      (error: unknown) => error instanceof ModalSessionError && error.code === "method_not_enabled",
    );
  });
});

describe("ModalSessionService.recordAttempt", () => {
  function seededSession(overrides: Partial<ModalSessionDocument> = {}): ModalSessionDocument {
    return {
      _id: "mss_1",
      projectId: "prj_1",
      customerId: "cus_1",
      allowedTypes: ["sms_code"],
      attempts: 0,
      maxAttempts: MODAL_SESSION_MAX_ATTEMPTS,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it("increments attempts and returns the updated session while under the cap", async () => {
    const { db } = createFakeDb(seededSession());
    const service = new ModalSessionService(db);

    const updated = await service.recordAttempt("mss_1");
    assert.equal(updated.attempts, 1);
  });

  it("throws once every allowed attempt has already been spent", async () => {
    const { db } = createFakeDb(seededSession({ attempts: MODAL_SESSION_MAX_ATTEMPTS }));
    const service = new ModalSessionService(db);

    await assert.rejects(
      () => service.recordAttempt("mss_1"),
      (error: unknown) =>
        error instanceof ModalSessionError && error.code === "modal_session_attempts_exhausted",
    );
  });

  it("fails closed for an unknown session id", async () => {
    const { db } = createFakeDb();
    const service = new ModalSessionService(db);

    await assert.rejects(
      () => service.recordAttempt("mss_missing"),
      (error: unknown) => error instanceof ModalSessionError && error.code === "modal_session_not_found",
    );
  });

  it("fails closed for an expired session even before Mongo's TTL sweep removes it", async () => {
    const { db } = createFakeDb(seededSession({ expiresAt: new Date(Date.now() - 1_000) }));
    const service = new ModalSessionService(db);

    await assert.rejects(
      () => service.recordAttempt("mss_1"),
      (error: unknown) => error instanceof ModalSessionError && error.code === "modal_session_not_found",
    );
  });
});

describe("ModalSessionService.config", () => {
  it("reports attemptsRemaining and never leaks project secrets", async () => {
    const { db } = createFakeDb({
      _id: "mss_1",
      projectId: "prj_1",
      customerId: "cus_1",
      allowedTypes: ["voice_code"],
      attempts: 1,
      maxAttempts: MODAL_SESSION_MAX_ATTEMPTS,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new ModalSessionService(db);

    const config = await service.config("mss_1", "Acme Inc");
    assert.equal(config.projectName, "Acme Inc");
    assert.equal(config.attemptsRemaining, MODAL_SESSION_MAX_ATTEMPTS - 1);
    assert.deepEqual(Object.keys(config).sort(), [
      "allowedTypes",
      "attemptsRemaining",
      "expiresAt",
      "projectName",
      "sessionId",
    ]);
  });
});
