import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  BOTBLOCKER_MATCH_LOOKBACK_SECONDS,
  BOTBLOCKER_RETENTION_SECONDS,
  BotBlockerIntelligencePersistence,
  botBlockerMatchCutoff,
  botBlockerRetentionExpiresAt,
  createBotBlockerChallengeId,
  createGateSessionId,
  createRiskEventId,
  createUserIntelligenceId,
  ensureBotBlockerIntelligenceIndexes,
} from "./botblocker-intelligence-persistence.js";

interface CapturedIndex {
  collection: string;
  keys: Record<string, number>;
  options?: Record<string, unknown>;
}

const ownerScope = {
  customerId: "usr_owner",
  projectId: "prj_owner",
  siteId: "bbs_owner_site_123",
};
const otherProjectScope = {
  customerId: "usr_owner",
  projectId: "prj_other",
  siteId: "bbs_other_site_123",
};

function indexDb(captured: CapturedIndex[]): Db {
  return {
    collection(name: string) {
      return {
        createIndex: async (
          keys: Record<string, number>,
          options?: Record<string, unknown>,
        ) => {
          captured.push({ collection: name, keys, options });
          return `${name}_index`;
        },
      };
    },
  } as unknown as Db;
}

function dataDb(): Db {
  const documents = {
    gateSessions: [{
      _id: "bgs_shared_session",
      ...ownerScope,
      userIntelligenceId: "bui_owner_123456",
      lastAppliedSequence: 2,
    }],
    userIntelligence: [{
      _id: "bui_owner_123456",
      ...ownerScope,
    }],
    botblockerChallenges: [{
      _id: "bbc_owner_123456",
      ...ownerScope,
      gateSessionId: "bgs_shared_session",
    }],
    riskEvents: [{
      _id: "bre_owner_123456",
      ...ownerScope,
      gateSessionId: "bgs_shared_session",
      reportSequence: 1,
      eventIndex: 0,
    }],
  } satisfies Record<string, Record<string, unknown>[]>;

  return {
    collection(name: keyof typeof documents) {
      const rows = documents[name] ?? [];
      return {
        findOne: async (filter: Record<string, unknown>) =>
          rows.find((row) => matches(row, filter)) ?? null,
        findOneAndUpdate: async (
          filter: Record<string, unknown>,
          update: { $set: Record<string, unknown> },
        ) => {
          const row = rows.find((candidate) => matches(candidate, filter));
          if (!row) return null;
          Object.assign(row, update.$set);
          return row;
        },
        find(filter: Record<string, unknown>) {
          const matching = rows.filter((row) => matches(row, filter));
          return {
            sort() {
              return {
                toArray: async () => matching,
              };
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function matches(
  row: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "$lt" in value
    ) {
      return Number(row[key]) < Number((value as { $lt: number }).$lt);
    }
    return row[key] === value;
  });
}

describe("BotBlocker intelligence persistence", () => {
  it("creates opaque server-side identifiers for every durable entity", () => {
    const ids = [
      createGateSessionId(),
      createUserIntelligenceId(),
      createRiskEventId(),
      createBotBlockerChallengeId(),
    ];

    assert.equal(new Set(ids).size, 4);
    assert.deepEqual(
      ids.map((id) => id.slice(0, 4)),
      ["bgs_", "bui_", "bre_", "bbc_"],
    );
  });

  it("encodes the approved 18-month retention and 30-day matching window", () => {
    assert.equal(BOTBLOCKER_RETENTION_SECONDS, 548 * 24 * 60 * 60);
    assert.equal(BOTBLOCKER_MATCH_LOOKBACK_SECONDS, 30 * 24 * 60 * 60);

    const anchor = new Date("2026-08-13T12:00:00.000Z");
    assert.equal(
      botBlockerRetentionExpiresAt(anchor).getTime() - anchor.getTime(),
      BOTBLOCKER_RETENTION_SECONDS * 1_000,
    );
    assert.equal(
      anchor.getTime() - botBlockerMatchCutoff(anchor).getTime(),
      BOTBLOCKER_MATCH_LOOKBACK_SECONDS * 1_000,
    );
  });

  it("creates TTL, sequence-idempotency, relationship, and lookup indexes", async () => {
    const captured: CapturedIndex[] = [];
    await ensureBotBlockerIntelligenceIndexes(indexDb(captured));

    for (const collection of [
      "gateSessions",
      "userIntelligence",
      "riskEvents",
      "botblockerChallenges",
    ]) {
      assert.ok(captured.some(
        (index) =>
          index.collection === collection &&
          index.keys.retentionExpiresAt === 1 &&
          index.options?.expireAfterSeconds === 0,
      ));
    }

    assert.ok(captured.some(
      (index) =>
        index.collection === "riskEvents" &&
        index.keys.reportSequence === 1 &&
        index.keys.eventIndex === 1 &&
        index.options?.unique === true,
    ));
    assert.ok(captured.some(
      (index) =>
        index.collection === "userIntelligence" &&
        index.keys.fingerprintHash === 1 &&
        index.keys["ipObservations.ip"] === 1 &&
        index.keys.lastObservedAt === -1,
    ));
  });

  it("keeps IP lookup non-unique because an IP is an observation", async () => {
    const captured: CapturedIndex[] = [];
    await ensureBotBlockerIntelligenceIndexes(indexDb(captured));

    const ipIndex = captured.find(
      (index) => index.keys["ipObservations.ip"] === 1,
    );
    assert.ok(ipIndex);
    assert.notEqual(ipIndex.options?.unique, true);
  });

  it("requires exact customer, project, and site scope for every entity", async () => {
    const persistence = new BotBlockerIntelligencePersistence(dataDb());

    assert.ok(await persistence.findGateSession(
      ownerScope,
      "bgs_shared_session",
    ));
    assert.equal(
      await persistence.findGateSession(
        otherProjectScope,
        "bgs_shared_session",
      ),
      null,
    );
    assert.equal(
      await persistence.findUserIntelligence(
        otherProjectScope,
        "bui_owner_123456",
      ),
      null,
    );
    assert.equal(
      await persistence.findChallenge(
        otherProjectScope,
        "bbc_owner_123456",
      ),
      null,
    );
    assert.deepEqual(
      await persistence.listRiskEvents(
        otherProjectScope,
        "bgs_shared_session",
      ),
      [],
    );
  });

  it("returns only scoped session observations in sequence order", async () => {
    const persistence = new BotBlockerIntelligencePersistence(dataDb());
    const events = await persistence.listRiskEvents(
      ownerScope,
      "bgs_shared_session",
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?._id, "bre_owner_123456");
  });

  it("atomically rejects equal, older, and cross-project report sequences", async () => {
    const persistence = new BotBlockerIntelligencePersistence(dataDb());
    const observedAt = new Date("2026-08-13T12:00:30.000Z");

    assert.equal(
      await persistence.advanceGateSessionSequence(
        ownerScope,
        "bgs_shared_session",
        2,
        observedAt,
      ),
      null,
    );
    assert.equal(
      await persistence.advanceGateSessionSequence(
        ownerScope,
        "bgs_shared_session",
        1,
        observedAt,
      ),
      null,
    );
    assert.equal(
      await persistence.advanceGateSessionSequence(
        otherProjectScope,
        "bgs_shared_session",
        3,
        observedAt,
      ),
      null,
    );
    const advanced = await persistence.advanceGateSessionSequence(
      ownerScope,
      "bgs_shared_session",
      3,
      observedAt,
    );
    assert.equal(advanced?.lastAppliedSequence, 3);
  });
});
