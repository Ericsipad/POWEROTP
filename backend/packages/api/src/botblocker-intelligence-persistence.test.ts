import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClientSession, Db } from "mongodb";

import {
  BOTBLOCKER_MATCH_LOOKBACK_SECONDS,
  BOTBLOCKER_RETENTION_SECONDS,
  BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS,
  BotBlockerIntelligencePersistence,
  botBlockerMatchCutoff,
  botBlockerRetentionExpiresAt,
  botBlockerSessionInputRetentionExpiresAt,
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
            toArray: async () => matching,
          };
        },
      };
    },
  } as unknown as Db;
}

function evaluateUpdateExpression(
  expression: unknown,
  row: Record<string, unknown>,
): unknown {
  if (typeof expression === "string" && expression.startsWith("$")) {
    return row[expression.slice(1)];
  }
  if (
    typeof expression !== "object" ||
    expression === null ||
    Array.isArray(expression)
  ) {
    return expression;
  }
  const value = expression as Record<string, unknown>;
  if ("$ifNull" in value) {
    const [candidate, fallback] = value.$ifNull as unknown[];
    return evaluateUpdateExpression(candidate, row) ??
      evaluateUpdateExpression(fallback, row);
  }
  for (const operator of ["$add", "$multiply"] as const) {
    if (operator in value) {
      const values = (value[operator] as unknown[]).map((item) =>
        Number(evaluateUpdateExpression(item, row))
      );
      return operator === "$add"
        ? values.reduce((sum, item) => sum + item, 0)
        : values.reduce((product, item) => product * item, 1);
    }
  }
  if ("$divide" in value) {
    const [left, right] = value.$divide as unknown[];
    return Number(evaluateUpdateExpression(left, row)) /
      Number(evaluateUpdateExpression(right, row));
  }
  if ("$subtract" in value) {
    const [left, right] = value.$subtract as unknown[];
    return Number(evaluateUpdateExpression(left, row)) -
      Number(evaluateUpdateExpression(right, row));
  }
  return expression;
}

function matches(
  row: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (typeof value === "object" && value !== null && "$lt" in value) {
      return Number(row[key]) < Number((value as { $lt: number }).$lt);
    }
    if (typeof value === "object" && value !== null && "$gte" in value) {
      const rowValue = row[key];
      const bound = (value as { $gte: Date }).$gte;
      return rowValue instanceof Date
        ? rowValue.getTime() >= bound.getTime()
        : Number(rowValue) >= Number(bound);
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

  it("encodes 90-day session inputs, 18-month profiles, and 30-day matching", () => {
    assert.equal(BOTBLOCKER_RETENTION_SECONDS, 548 * 24 * 60 * 60);
    assert.equal(
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS,
      90 * 24 * 60 * 60,
    );
    assert.equal(BOTBLOCKER_MATCH_LOOKBACK_SECONDS, 30 * 24 * 60 * 60);

    const anchor = new Date("2026-08-13T12:00:00.000Z");
    assert.equal(
      botBlockerRetentionExpiresAt(anchor).getTime() - anchor.getTime(),
      BOTBLOCKER_RETENTION_SECONDS * 1_000,
    );
    assert.equal(
      botBlockerSessionInputRetentionExpiresAt(anchor).getTime() -
        anchor.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
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
        index.options?.unique === true,
    ));
    assert.ok(captured.some(
      (index) =>
        index.collection === "userIntelligence" &&
        index.keys["fingerprintVerifyLookup.hash"] === 1 &&
        index.keys.lastObservedAt === -1,
    ));
  });

  it("keeps IP lookups non-unique because an IP is an observation", async () => {
    const captured: CapturedIndex[] = [];
    await ensureBotBlockerIntelligenceIndexes(indexDb(captured));

    const profileIpIndex = captured.find(
      (index) => index.keys["currentIp.ip"] === 1,
    );
    assert.ok(profileIpIndex);
    assert.notEqual(profileIpIndex.options?.unique, true);

    const sessionIpIndex = captured.find(
      (index) =>
        index.collection === "gateSessions" &&
        index.keys.ip === 1 &&
        index.keys.lastObservedAt === -1,
    );
    assert.ok(sessionIpIndex);
    assert.notEqual(sessionIpIndex.options?.unique, true);
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

  it("atomically accumulates concurrent available row scores without a lost update", async () => {
    const profile: Record<string, unknown> = {
      _id: "bui_owner_123456",
      ...ownerScope,
    };
    const db = {
      collection(name: string) {
        return name === "userIntelligence"
          ? {
            updateOne: async (
              filter: Record<string, unknown>,
              update: Record<string, unknown>[],
            ) => {
              if (!matches(profile, filter)) return { matchedCount: 0 };
              const set = update[0]?.$set as Record<string, unknown>;
              const snapshot = { ...profile };
              for (const [key, expression] of Object.entries(set)) {
                profile[key] = evaluateUpdateExpression(expression, snapshot);
              }
              return { matchedCount: 1 };
            },
          }
          : {};
      },
    } as unknown as Db;
    const persistence = new BotBlockerIntelligencePersistence(db);
    const session = {} as ClientSession;

    await Promise.all([
      persistence.incorporateRiskEventScore(
        ownerScope,
        "bui_owner_123456",
        { status: "available", score: 10 },
        session,
      ),
      persistence.incorporateRiskEventScore(
        ownerScope,
        "bui_owner_123456",
        { status: "available", score: 30 },
        session,
      ),
      persistence.incorporateRiskEventScore(
        ownerScope,
        "bui_owner_123456",
        { status: "available", score: 80 },
        session,
      ),
    ]);

    assert.equal(profile.risk_events_sum, 40);
    assert.equal(profile.riskEventScoredRowCount, 3);
  });

  it("counts distinct system-wide and same-site profiles for an exact IP over 1/7/30 days", async () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1_000;
    const sameSiteOtherSession = {
      _id: "bgs_same_site_other",
      ...ownerScope,
      ip: "203.0.113.5",
      userIntelligenceId: "bui_other_same_site",
      lastObservedAt: new Date(now.getTime() - 2 * day),
    };
    const sameProfileReconnect = {
      _id: "bgs_same_profile_again",
      ...ownerScope,
      ip: "203.0.113.5",
      userIntelligenceId: "bui_owner_123456",
      lastObservedAt: new Date(now.getTime() - 5 * day),
    };
    const otherSiteSameIp = {
      _id: "bgs_other_site",
      ...otherProjectScope,
      ip: "203.0.113.5",
      userIntelligenceId: "bui_other_site",
      lastObservedAt: new Date(now.getTime() - 20 * day),
    };
    const staleBeyondWindow = {
      _id: "bgs_too_old",
      ...ownerScope,
      ip: "203.0.113.5",
      userIntelligenceId: "bui_too_old",
      lastObservedAt: new Date(now.getTime() - 31 * day),
    };
    const differentIp = {
      _id: "bgs_different_ip",
      ...ownerScope,
      ip: "198.51.100.9",
      userIntelligenceId: "bui_different_ip",
      lastObservedAt: now,
    };
    const db = {
      collection(name: string) {
        const rows = name === "gateSessions"
          ? [
            sameSiteOtherSession,
            sameProfileReconnect,
            otherSiteSameIp,
            staleBeyondWindow,
            differentIp,
          ]
          : [];
        return {
          find(filter: Record<string, unknown>) {
            const matching = rows.filter((row) => matches(row, filter));
            return { toArray: async () => matching };
          },
        };
      },
    } as unknown as Db;
    const persistence = new BotBlockerIntelligencePersistence(db);

    const reuse = await persistence.countIpReuse(
      "203.0.113.5",
      ownerScope,
      now,
    );

    assert.deepEqual(reuse.global, {
      distinctProfiles1d: 0,
      distinctProfiles7d: 2,
      distinctProfiles30d: 3,
    });
    assert.deepEqual(reuse.site, {
      distinctProfiles1d: 0,
      distinctProfiles7d: 2,
      distinctProfiles30d: 2,
    });
  });
});
