import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

import type {
  BrowserEvidence,
  FingerprintVector,
  RapidAuthRequest,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import type { FingerprintDataDocument } from "./botblocker-fingerprint-persistence.js";
import type {
  DurableRiskEventDocument,
  GateSessionDocument,
  UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";
import {
  BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS,
} from "./botblocker-intelligence-persistence.js";
import {
  BotBlockerSessionPersistence,
  BotBlockerSessionPersistenceError,
} from "./botblocker-session-persistence.js";

const now = new Date("2026-08-17T12:00:00.000Z");
const scope = {
  customerId: "usr_owner",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
};
const evidence: BrowserEvidence = {
  routePath: "/",
  clicks: [],
  mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
  scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
  honeypotActivations: [],
};

function vector(platform = "Win32"): FingerprintVector {
  return {
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: {
      userAgentData: {
        status: "available",
        value: { brands: ["Example/140"], mobile: false, platform },
      },
    },
  };
}

function completeVector(): FingerprintVector {
  return {
    ...vector("Windows 15"),
    components: {
      ...vector("Windows 15").components,
      userAgentData: {
        status: "available",
        value: {
          brands: ["Example/140"],
          mobile: false,
          platform: "Windows 15",
          architecture: "x86",
          bitness: "64",
        },
      },
      architecture: { status: "available", value: 255 },
      hardwareConcurrency: { status: "available", value: 8 },
      deviceMemory: { status: "available", value: 12 },
      touchSupport: {
        status: "available",
        value: { maxTouchPoints: 0, touchEvent: false, touchStart: false },
      },
      screenResolution: {
        status: "available",
        value: { width: 1920, height: 1080 },
      },
      colorDepth: { status: "available", value: 24 },
      colorGamut: { status: "available", value: "srgb" },
      webGlBasics: {
        status: "available",
        value: {
          version: "WebGL 1",
          vendor: "WebKit",
          vendorUnmasked: "Google",
          renderer: "WebGL",
          rendererUnmasked: "ANGLE",
          shadingLanguageVersion: "GLSL 1",
        },
      },
      webGlExtensions: {
        status: "available",
        value: {
          contextAttributes: [],
          parameters: [],
          shaderPrecisions: [],
          extensions: [],
          extensionParameters: [],
          unsupportedExtensions: [],
        },
      },
      canvas: {
        status: "available",
        value: { winding: true, geometry: "geometry", text: "text" },
      },
      audio: { status: "available", value: 124 },
      audioBaseLatency: { status: "available", value: 0.01 },
      fonts: { status: "available", value: ["Arial"] },
      fontPreferences: {
        status: "available",
        value: {
          default: 1,
          apple: 1,
          serif: 1,
          sans: 1,
          mono: 1,
          min: 1,
          system: 1,
        },
      },
      vendor: { status: "available", value: "Example Inc." },
    },
  };
}

function fixture(options: {
  intelligence?: UserIntelligenceDocument[];
  fingerprints?: FingerprintDataDocument[];
  failGateInsert?: boolean;
  failRiskInsert?: boolean;
} = {}) {
  const gateSessions: GateSessionDocument[] = [];
  const riskEvents: DurableRiskEventDocument[] = [];
  const intelligence = structuredClone(options.intelligence ?? []);
  const fingerprints = structuredClone(options.fingerprints ?? []);
  const collection = (name: string) => {
    const rows = name === "gateSessions"
      ? gateSessions
      : name === "userIntelligence"
      ? intelligence
      : name === "riskEvents"
      ? riskEvents
      : fingerprints;
    return {
      findOne: async (
        filter: Record<string, unknown>,
        query?: { sort?: Record<string, number> },
      ) => {
        const matches = rows.filter((row) => matchesFilter(row, filter));
        if (query?.sort && name === "fingerprintData") {
          (matches as FingerprintDataDocument[]).sort((left, right) =>
            right.serverObservedAt.getTime() - left.serverObservedAt.getTime() ||
            right.sourceGateSessionId.localeCompare(left.sourceGateSessionId)
          );
        }
        return matches[0] ?? null;
      },
      find: (filter: Record<string, unknown>) => {
        const matches = rows.filter((row) => matchesFilter(row, filter));
        return { toArray: async () => matches };
      },
      insertOne: async (document: never) => {
        if (name === "gateSessions" && options.failGateInsert) {
          throw new Error("injected gate insert failure");
        }
        if (name === "riskEvents" && options.failRiskInsert) {
          throw new Error("injected risk insert failure");
        }
        (rows as unknown[]).push(document);
      },
      replaceOne: async (
        filter: Record<string, unknown>,
        document: never,
      ) => {
        const index = rows.findIndex((row) => matchesFilter(row, filter));
        if (index < 0) return { matchedCount: 0 };
        (rows as unknown[])[index] = document;
        return { matchedCount: 1 };
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: {
          $set?: Record<string, unknown>;
          $unset?: Record<string, unknown>;
          $inc?: Record<string, number>;
        },
      ) => {
        const row = rows.find((candidate) => matchesFilter(candidate, filter));
        if (!row) return { matchedCount: 0 };
        Object.assign(row, update.$set);
        for (const key of Object.keys(update.$unset ?? {})) {
          delete (row as Record<string, unknown>)[key];
        }
        for (const [key, amount] of Object.entries(update.$inc ?? {})) {
          const record = row as Record<string, unknown>;
          record[key] = Number(record[key] ?? 0) + amount;
        }
        return { matchedCount: 1 };
      },
    };
  };
  const db = { collection } as unknown as Db;
  const client = {
    withSession: async (
      work: (session: {
        withTransaction: (transaction: () => Promise<void>) => Promise<void>;
      }) => Promise<void>,
    ) => work({
      withTransaction: async (transaction) => {
        const snapshot = structuredClone({
          gateSessions,
          intelligence,
          fingerprints,
          riskEvents,
        });
        try {
          await transaction();
        } catch (error) {
          gateSessions.splice(0, gateSessions.length, ...snapshot.gateSessions);
          intelligence.splice(0, intelligence.length, ...snapshot.intelligence);
          fingerprints.splice(0, fingerprints.length, ...snapshot.fingerprints);
          riskEvents.splice(0, riskEvents.length, ...snapshot.riskEvents);
          throw error;
        }
      },
    }),
  } as unknown as MongoClient;
  return {
    persistence: new BotBlockerSessionPersistence(db, client),
    gateSessions,
    intelligence,
    fingerprints,
    riskEvents,
  };
}

function profile(
  id: string,
  ip = "203.0.113.5",
): UserIntelligenceDocument {
  return {
    _id: id,
    ...scope,
    fingerprintVerifySource: { platformFamily: "windows" },
    fingerprintVerifyLookup: {
      recipeVersion: 1,
      status: "unavailable",
      reason: "missing_stable_inputs",
    },
    currentIp: { ip, blacklisted: false },
    recentIpHistory: [],
    gateSessionCount: 1,
    behaviorReportCount: 0,
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: new Date(now.getTime() + 548 * 86_400_000),
  };
}

function storedFingerprint(
  userIntelligenceId: string,
  platform = "Win32",
): FingerprintDataDocument {
  return {
    _id: userIntelligenceId,
    ...scope,
    userIntelligenceId,
    sourceGateSessionId: "bgs_existing_123456",
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: vector(platform).components,
    serverObservedAt: now,
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: new Date(now.getTime() + 548 * 86_400_000),
  };
}

function rapidRequest(
  gateSessionId: string,
  fingerprint: FingerprintVector,
  issuedAt: number,
): RapidAuthRequest {
  return {
    protocolVersion: 1,
    siteId: scope.siteId,
    gateSessionId,
    audience: "https://customer.example",
    nonce: "nonce_initial_request_123456",
    issuedAt,
    payload: {
      gateSessionId,
      request: {
        siteId: scope.siteId,
        clientIp: "203.0.113.5",
        method: "GET",
        path: "/",
      },
      browser: {
        protocolVersion: 1,
        evidence,
        fingerprint,
        proofs: {},
      },
    },
  };
}

function openInput(overrides: Record<string, unknown> = {}) {
  const gateSessionId =
    (overrides.gateSessionId as string | undefined) ??
      "bgs_session_m_123456";
  const observedAt = (overrides.now as Date | undefined) ?? now;
  const fingerprint =
    (overrides.fingerprint as FingerprintVector | undefined) ?? vector();
  const {
    fingerprint: _fingerprint,
    ...remainingOverrides
  } = overrides;
  return {
    scope,
    gateSessionId,
    initialRequest: rapidRequest(
      gateSessionId,
      fingerprint,
      observedAt.getTime(),
    ),
    verifyHashSecret: "verify-hash-secret-at-least-32-characters",
    ip: "203.0.113.5",
    ipBlacklisted: false,
    now: observedAt,
    ...remainingOverrides,
  };
}

describe("BotBlockerSessionPersistence fingerprint selection", () => {
  it("uses exact raw-fingerprint fallback without requiring an IP match", async () => {
    const existing = profile("bui_existing_123456", "198.51.100.1");
    const state = fixture({
      intelligence: [existing],
      fingerprints: [storedFingerprint(existing._id)],
    });
    const session = await state.persistence.openGateSession(openInput());

    assert.equal(session.userIntelligenceId, existing._id);
    assert.equal(state.intelligence.length, 1);
    assert.equal(state.intelligence[0]!.gateSessionCount, 2);
    assert.equal(state.riskEvents.length, 1);
    assert.equal(state.riskEvents[0]!.recordType, "initial_request");
  });

  it("never selects on IP-only or non-exact fingerprint evidence", async () => {
    const existing = profile("bui_existing_123456");
    const state = fixture({
      intelligence: [existing],
      fingerprints: [storedFingerprint(existing._id)],
    });
    const session = await state.persistence.openGateSession(openInput({
      fingerprint: vector("Linux"),
    }));

    assert.notEqual(session.userIntelligenceId, existing._id);
    assert.equal(state.intelligence.length, 2);
  });

  it("gives authoritative binding precedence and replaces the current raw vector", async () => {
    const bound = profile("bui_bound_123456789");
    const rawMatch = profile("bui_raw_match_123456");
    const state = fixture({
      intelligence: [bound, rawMatch],
      fingerprints: [
        storedFingerprint(bound._id),
        storedFingerprint(rawMatch._id, "Linux"),
      ],
    });
    const session = await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_session_z_123456",
      authoritativeUserIntelligenceId: bound._id,
      fingerprint: vector("Linux"),
      now: new Date(now.getTime() + 1),
    }));

    assert.equal(session.userIntelligenceId, bound._id);
    assert.equal(
      state.intelligence[0]!.fingerprintVerifySource?.platformFamily,
      "linux",
    );
    assert.equal(state.fingerprints.length, 2);
    assert.equal(
      state.fingerprints.filter((row) => row.userIntelligenceId === bound._id)
        .length,
      1,
    );
    assert.deepEqual(state.fingerprints[0]!.components, vector("Linux").components);
    assert.equal("stableFingerprintHash" in state.fingerprints[0]!, false);
  });

  it("prevents stale and lower equal-time sessions from replacing current raw data", async () => {
    const bound = profile("bui_bound_123456789");
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_a_session_123456",
      authoritativeUserIntelligenceId: bound._id,
      fingerprint: vector("Linux"),
      now,
    }));
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_session_old_12345",
      authoritativeUserIntelligenceId: bound._id,
      fingerprint: vector("MacIntel"),
      now: new Date(now.getTime() - 1),
    }));

    assert.equal(
      state.intelligence[0]!.fingerprintVerifySource?.platformFamily,
      "windows",
    );
    assert.deepEqual(state.fingerprints[0]!.components, vector().components);
  });

  it("derives the only fingerprint hash from persisted user-row source fields", async () => {
    const state = fixture();
    const session = await state.persistence.openGateSession(openInput({
      fingerprint: completeVector(),
    }));

    assert.match(
      state.intelligence[0]!.fingerprintVerifyLookup?.status === "available"
        ? state.intelligence[0]!.fingerprintVerifyLookup.hash
        : "",
      /^[a-f0-9]{64}$/,
    );
    assert.equal("fingerprintHash" in session, false);
    assert.equal("stableFingerprintHash" in state.fingerprints[0]!, false);
  });

  it("makes session replay idempotent and rejects cross-scope reuse", async () => {
    const state = fixture();
    const first = await state.persistence.openGateSession(openInput());
    const replay = await state.persistence.openGateSession(openInput());
    assert.equal(replay._id, first._id);
    assert.equal(state.gateSessions.length, 1);
    assert.equal(state.riskEvents.length, 1);
    assert.equal(state.intelligence[0]!.gateSessionCount, 1);

    await assert.rejects(
      state.persistence.openGateSession(openInput({
        scope: { ...scope, projectId: "prj_other_123456789" },
      })),
      (error: unknown) =>
        error instanceof BotBlockerSessionPersistenceError &&
        error.code === "scope_mismatch",
    );
  });

  it("rolls back profile and fingerprint writes when session insertion fails", async () => {
    const state = fixture({ failGateInsert: true });
    await assert.rejects(
      state.persistence.openGateSession(openInput()),
      /injected gate insert failure/,
    );
    assert.deepEqual(state.gateSessions, []);
    assert.deepEqual(state.riskEvents, []);
    assert.deepEqual(state.intelligence, []);
    assert.deepEqual(state.fingerprints, []);
  });

  it("rolls back the session before any profile or fingerprint write when the initial event fails", async () => {
    const state = fixture({ failRiskInsert: true });
    await assert.rejects(
      state.persistence.openGateSession(openInput()),
      /injected risk insert failure/,
    );
    assert.deepEqual(state.gateSessions, []);
    assert.deepEqual(state.riskEvents, []);
    assert.deepEqual(state.intelligence, []);
    assert.deepEqual(state.fingerprints, []);
  });

  it("stores the same complete bounded initial request on the session and first event for 90 days", async () => {
    const state = fixture();
    const session = await state.persistence.openGateSession(openInput());
    const event = state.riskEvents[0]!;

    assert.deepEqual(session.initialRequest, event.initialRequest);
    assert.equal(event.recordType, "initial_request");
    assert.equal(event.reportSequence, -1);
    assert.equal(event.eventIndex, 0);
    assert.equal(
      session.retentionExpiresAt.getTime() - now.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
    );
    assert.equal(
      event.retentionExpiresAt.getTime() - event.occurredAt.getTime(),
      BOTBLOCKER_SESSION_INPUT_RETENTION_SECONDS * 1_000,
    );
    assert.deepEqual(
      session.initialRequest.request.payload.browser.fingerprint,
      vector(),
    );
    assert.deepEqual(session.initialRequest.request.payload.browser.proofs, {});
    assert.equal(session.initialRequest.risk.ipBlacklisted, false);
  });

  it("rejects stale and conflicting reuse of an initialized gate session", async () => {
    const state = fixture();
    await state.persistence.openGateSession(openInput());

    await assert.rejects(
      state.persistence.openGateSession(openInput({
        fingerprint: vector("Linux"),
        now: new Date(now.getTime() - 1),
      })),
      (error: unknown) =>
        error instanceof BotBlockerSessionPersistenceError &&
        error.code === "stale_initial_request",
    );
    await assert.rejects(
      state.persistence.openGateSession(openInput({
        fingerprint: vector("Linux"),
        now: new Date(now.getTime() + 1),
      })),
      (error: unknown) =>
        error instanceof BotBlockerSessionPersistenceError &&
        error.code === "conflicting_replay",
    );
    assert.equal(state.gateSessions.length, 1);
    assert.equal(state.riskEvents.length, 1);
    assert.equal(state.intelligence.length, 1);
    assert.equal(state.fingerprints.length, 1);
  });

  it("stores only safe visitor-token metadata after the session exists", async () => {
    const state = fixture();
    await state.persistence.openGateSession(openInput());
    await state.persistence.saveVisitorTokenMetadata({
      scope,
      gateSessionId: "bgs_session_m_123456",
      metadata: {
        tokenId: "bvt_token_123456789",
        expiresAt: new Date(now.getTime() + 30 * 60_000),
        nonceDigest: "a".repeat(64),
        tokenDigest: "b".repeat(64),
      },
      now,
    });

    assert.equal(state.gateSessions[0]!.tokenMetadata?.tokenId, "bvt_token_123456789");
    assert.equal(JSON.stringify(state.gateSessions[0]).includes("visitorBearer"), false);
  });
});

describe("BotBlockerSessionPersistence gate-session profile synchronization (IP evidence)", () => {
  it("sets currentIp with empty history on a brand-new profile", async () => {
    const state = fixture();
    await state.persistence.openGateSession(openInput());

    assert.deepEqual(state.intelligence[0]!.currentIp, {
      ip: "203.0.113.5",
      blacklisted: false,
    });
    assert.deepEqual(state.intelligence[0]!.recentIpHistory, []);
  });

  it("refreshes the current IP's ASN score and blacklist boolean in place when the IP repeats", async () => {
    const bound = profile("bui_bound_123456789");
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_repeat_a_123456",
      authoritativeUserIntelligenceId: bound._id,
      ipBlacklisted: true,
      networkClassification: {
        asn: 64512,
        asnOrg: "Example Networks",
        asnType: "datacenter",
        score: 40,
        requiresApiLookup: false,
      },
      now: new Date(now.getTime() + 1),
    }));

    assert.deepEqual(state.intelligence[0]!.currentIp, {
      ip: "203.0.113.5",
      asnScore: 40,
      blacklisted: true,
    });
    assert.deepEqual(state.intelligence[0]!.recentIpHistory, []);
  });

  it("moves the outgoing current IP into history when the IP changes", async () => {
    const bound = profile("bui_bound_123456789");
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_change_a_123456",
      authoritativeUserIntelligenceId: bound._id,
      ip: "198.51.100.7",
      ipBlacklisted: false,
      now: new Date(now.getTime() + 1),
    }));

    assert.deepEqual(state.intelligence[0]!.currentIp, {
      ip: "198.51.100.7",
      blacklisted: false,
    });
    assert.deepEqual(state.intelligence[0]!.recentIpHistory, [
      { ip: "203.0.113.5", blacklisted: false },
    ]);
  });

  it("moves a reappearing history IP back into currentIp without duplication", async () => {
    const bound: UserIntelligenceDocument = {
      ...profile("bui_bound_123456789"),
      currentIp: { ip: "203.0.113.5", blacklisted: false },
      recentIpHistory: [
        { ip: "198.51.100.7", asnScore: 12, blacklisted: false },
        { ip: "198.51.100.8", blacklisted: false },
      ],
    };
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_reappear_123456",
      authoritativeUserIntelligenceId: bound._id,
      ip: "198.51.100.7",
      ipBlacklisted: false,
      now: new Date(now.getTime() + 1),
    }));

    const updated = state.intelligence[0]!;
    assert.deepEqual(updated.currentIp, {
      ip: "198.51.100.7",
      asnScore: 12,
      blacklisted: false,
    });
    assert.deepEqual(updated.recentIpHistory, [
      { ip: "203.0.113.5", blacklisted: false },
      { ip: "198.51.100.8", blacklisted: false },
    ]);
  });

  it("trims recentIpHistory to the 20 most recent unique entries", async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      ip: `198.51.100.${index}`,
      blacklisted: false,
    }));
    const bound: UserIntelligenceDocument = {
      ...profile("bui_bound_123456789"),
      currentIp: { ip: "203.0.113.5", blacklisted: false },
      recentIpHistory: history,
    };
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_trim_a_1234567",
      authoritativeUserIntelligenceId: bound._id,
      ip: "203.0.113.99",
      ipBlacklisted: false,
      now: new Date(now.getTime() + 1),
    }));

    const updated = state.intelligence[0]!;
    assert.deepEqual(updated.currentIp, { ip: "203.0.113.99", blacklisted: false });
    assert.equal(updated.recentIpHistory.length, 20);
    assert.deepEqual(updated.recentIpHistory[0], {
      ip: "203.0.113.5",
      blacklisted: false,
    });
    assert.equal(
      updated.recentIpHistory.some((entry) => entry.ip === "198.51.100.19"),
      false,
    );
  });

  it("omits every IP update when the trusted request IP is missing", async () => {
    const bound = profile("bui_bound_123456789");
    const state = fixture({
      intelligence: [bound],
      fingerprints: [storedFingerprint(bound._id)],
    });
    const { ip: _ip, ipBlacklisted: _ipBlacklisted, ...withoutIp } = openInput({
      gateSessionId: "bgs_no_ip_12345678",
      authoritativeUserIntelligenceId: bound._id,
      now: new Date(now.getTime() + 1),
    });

    await state.persistence.openGateSession(withoutIp);

    assert.deepEqual(state.intelligence[0]!.currentIp, bound.currentIp);
    assert.deepEqual(state.intelligence[0]!.recentIpHistory, bound.recentIpHistory);
  });

  it("computes distinct global and same-site IP reuse counts from retained sessions", async () => {
    const state = fixture();
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_reuse_first_123",
      fingerprint: vector("Linux"),
    }));
    await state.persistence.openGateSession(openInput({
      gateSessionId: "bgs_reuse_second_12",
      fingerprint: vector("MacIntel"),
      now: new Date(now.getTime() + 1),
    }));

    assert.equal(state.intelligence.length, 2);
    const first = state.intelligence.find(
      (row) => row._id === state.gateSessions[0]!.userIntelligenceId,
    )!;
    const second = state.intelligence.find(
      (row) => row._id === state.gateSessions[1]!.userIntelligenceId,
    )!;
    assert.deepEqual(first.currentIpReuse, {
      global: { distinctProfiles1d: 1, distinctProfiles7d: 1, distinctProfiles30d: 1 },
      site: { distinctProfiles1d: 1, distinctProfiles7d: 1, distinctProfiles30d: 1 },
    });
    assert.deepEqual(second.currentIpReuse, {
      global: { distinctProfiles1d: 2, distinctProfiles7d: 2, distinctProfiles30d: 2 },
      site: { distinctProfiles1d: 2, distinctProfiles7d: 2, distinctProfiles30d: 2 },
    });
  });
});

function matchesFilter(
  row: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (typeof value === "object" && value !== null && "$gte" in value) {
      const rowValue = row[key];
      const bound = (value as { $gte: Date }).$gte;
      return rowValue instanceof Date && rowValue.getTime() >= bound.getTime();
    }
    return isDeepStrictEqual(row[key], value);
  });
}
