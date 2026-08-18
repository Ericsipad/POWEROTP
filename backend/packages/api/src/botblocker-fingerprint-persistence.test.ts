import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

import type { FingerprintVector } from "@powerotp/contracts";
import type { ClientSession, Db } from "mongodb";

import {
  BOTBLOCKER_RETENTION_SECONDS,
  type BotBlockerScope,
} from "./botblocker-intelligence-persistence.js";
import {
  FingerprintPersistence,
  FingerprintPersistenceError,
  ensureFingerprintDataIndexes,
  type FingerprintDataDocument,
} from "./botblocker-fingerprint-persistence.js";

const scope: BotBlockerScope = {
  customerId: "usr_owner",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const observedAt = new Date("2026-08-17T12:00:00.000Z");
const session = {} as ClientSession;

function vector(platform = "Win32"): FingerprintVector {
  return {
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: {
      platform: { status: "available", value: platform },
      fonts: { status: "unavailable" },
    },
  };
}

function memoryDb(rows: FingerprintDataDocument[] = []) {
  const indexes: Array<{
    keys: Record<string, number>;
    options?: Record<string, unknown>;
  }> = [];
  const collection = {
    createIndex: async (
      keys: Record<string, number>,
      options?: Record<string, unknown>,
    ) => {
      indexes.push({ keys, options });
      return "fingerprint_index";
    },
    findOne: async (
      filter: Record<string, unknown>,
      options?: { sort?: Record<string, number> },
    ) => {
      const matches = rows.filter((row) =>
        Object.entries(filter).every(([key, value]) =>
          isDeepStrictEqual(row[key as keyof FingerprintDataDocument], value)
        )
      );
      if (options?.sort) {
        matches.sort((left, right) =>
          right.serverObservedAt.getTime() - left.serverObservedAt.getTime() ||
          right.sourceGateSessionId.localeCompare(left.sourceGateSessionId)
        );
      }
      return matches[0] ?? null;
    },
    insertOne: async (document: FingerprintDataDocument) => {
      if (
        rows.some((row) =>
          row._id === document._id ||
          row.userIntelligenceId === document.userIntelligenceId
        )
      ) {
        throw new Error("duplicate key");
      }
      rows.push(document);
    },
    replaceOne: async (
      filter: Record<string, unknown>,
      document: FingerprintDataDocument,
    ) => {
      const index = rows.findIndex((row) =>
        Object.entries(filter).every(([key, value]) =>
          isDeepStrictEqual(row[key as keyof FingerprintDataDocument], value)
        )
      );
      if (index >= 0) rows[index] = document;
      return { matchedCount: index >= 0 ? 1 : 0 };
    },
  };
  return {
    db: {
      collection: () => collection,
    } as unknown as Db,
    rows,
    indexes,
  };
}

function writeInput(
  overrides: Partial<{
    scope: BotBlockerScope;
    userIntelligenceId: string;
    gateSessionId: string;
    vector: FingerprintVector;
    observedAt: Date;
  }> = {},
) {
  return {
    scope,
    userIntelligenceId: "bui_profile_123456",
    gateSessionId: "bgs_session_m_123456",
    vector: vector(),
    observedAt,
    ...overrides,
  };
}

describe("fingerprintData persistence", () => {
  it("creates the unique profile relationship, raw lookup, and TTL indexes", async () => {
    const state = memoryDb();
    await ensureFingerprintDataIndexes(state.db);

    assert.ok(state.indexes.some((index) =>
      index.keys.userIntelligenceId === 1 && index.options?.unique === true
    ));
    assert.ok(state.indexes.some((index) =>
      index.keys.customerId === 1 &&
      index.keys.projectId === 1 &&
      index.keys.siteId === 1 &&
      index.keys.fingerprintVersion === 1 &&
      index.keys.collectorVersion === 1
    ));
    assert.ok(state.indexes.some((index) =>
      index.keys.retentionExpiresAt === 1 &&
      index.options?.expireAfterSeconds === 0
    ));
  });

  it("maintains one current record per profile with 548-day retention", async () => {
    const state = memoryDb();
    const persistence = new FingerprintPersistence(state.db);
    const first = await persistence.writeCurrent(writeInput(), session);
    const newerAt = new Date(observedAt.getTime() + 1_000);
    const second = await persistence.writeCurrent(
      writeInput({
        gateSessionId: "bgs_session_n_123456",
        vector: vector("Linux"),
        observedAt: newerAt,
      }),
      session,
    );

    assert.equal(first.outcome, "accepted");
    assert.equal(second.outcome, "accepted");
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0]!.components.platform?.status, "available");
    assert.equal(
      state.rows[0]!.retentionExpiresAt.getTime() - newerAt.getTime(),
      BOTBLOCKER_RETENTION_SECONDS * 1_000,
    );
    assert.equal(state.rows[0]!.firstObservedAt.getTime(), observedAt.getTime());
  });

  it("uses observation time then gateSessionId ordering and makes exact replay idempotent", async () => {
    const state = memoryDb();
    const persistence = new FingerprintPersistence(state.db);
    await persistence.writeCurrent(writeInput(), session);

    const duplicate = await persistence.writeCurrent(writeInput(), session);
    const lowerTie = await persistence.writeCurrent(
      writeInput({ gateSessionId: "bgs_session_a_123456" }),
      session,
    );
    const higherTie = await persistence.writeCurrent(
      writeInput({
        gateSessionId: "bgs_session_z_123456",
        vector: vector("Linux"),
      }),
      session,
    );
    const stale = await persistence.writeCurrent(
      writeInput({
        gateSessionId: "bgs_session_zz_12345",
        observedAt: new Date(observedAt.getTime() - 1),
      }),
      session,
    );

    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(lowerTie.outcome, "stale");
    assert.equal(higherTie.outcome, "accepted");
    assert.equal(stale.outcome, "stale");
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0]!.sourceGateSessionId, "bgs_session_z_123456");
  });

  it("rejects conflicting replay and cross-scope profile reuse", async () => {
    const state = memoryDb();
    const persistence = new FingerprintPersistence(state.db);
    await persistence.writeCurrent(writeInput(), session);

    await assert.rejects(
      persistence.writeCurrent(
        writeInput({ vector: vector("Linux") }),
        session,
      ),
      (error: unknown) =>
        error instanceof FingerprintPersistenceError &&
        error.code === "conflicting_replay",
    );
    await assert.rejects(
      persistence.writeCurrent(
        writeInput({
          scope: { ...scope, projectId: "prj_other_123456789" },
          observedAt: new Date(observedAt.getTime() + 1),
        }),
        session,
      ),
      (error: unknown) =>
        error instanceof FingerprintPersistenceError &&
        error.code === "scope_mismatch",
    );
    assert.equal(state.rows.length, 1);
  });

  it("finds only an exact raw vector inside the full scope", async () => {
    const state = memoryDb();
    const persistence = new FingerprintPersistence(state.db);
    await persistence.writeCurrent(writeInput(), session);

    assert.equal(
      (await persistence.findExactVector(scope, vector(), session))
        ?.userIntelligenceId,
      "bui_profile_123456",
    );
    assert.equal(
      await persistence.findExactVector(
        { ...scope, siteId: "bbs_other_123456789" },
        vector(),
        session,
      ),
      null,
    );
    assert.equal(
      await persistence.findExactVector(scope, vector("Linux"), session),
      null,
    );
  });
});
