import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  FingerprintDataRecord,
  GateSessionRecord,
  UserIntelligenceRecord,
} from "./botblocker-persistence.js";
import {
  BehaviorReportEventRecordSchema,
  BotBlockerChallengeRecordSchema,
  FingerprintDataRecordSchema,
  GateSessionRecordSchema,
  InitialRequestEventRecordSchema,
  RiskSignalEventRecordSchema,
  UserIntelligenceRecordSchema,
} from "./botblocker-persistence.js";

const now = "2026-08-13T12:00:00.000Z";
const later = "2028-02-12T12:00:00.000Z";
const scope = {
  customerId: "usr_customer_123456",
  projectId: "prj_project_123456",
  siteId: "bbs_site_123456789",
};
const verifyHash = "a".repeat(64);
const ip = "203.0.113.5";
const evidence = {
  routePath: "/products",
  clicks: [{ category: "button" as const, powerOtpId: "add-to-cart" }],
  mouseDirectness: { averageDirectnessRatio: 0.7, sampleCount: 2 },
  scroll: { smoothnessScore: 0.8, highSpeedEventCount: 1 },
  honeypotActivations: [],
};
const initialRequest = {
  request: {
    protocolVersion: 1 as const,
    siteId: scope.siteId,
    gateSessionId: "bgs_session_123456",
    audience: "https://customer.example",
    nonce: "nonce_initial_123456789",
    issuedAt: Date.parse(now),
    payload: {
      gateSessionId: "bgs_session_123456",
      request: {
        siteId: scope.siteId,
        clientIp: ip,
        method: "GET" as const,
        path: "/products",
      },
      browser: {
        protocolVersion: 1 as const,
        evidence,
        proofs: {},
      },
    },
  },
  risk: { ipBlacklisted: false },
  serverObservedAt: now,
};

const gateSession = {
  ...scope,
  gateSessionId: "bgs_session_123456",
  userIntelligenceId: "bui_visitor_123456",
  initialRequest,
  ip,
  state: "active" as const,
  lastAppliedSequence: -1,
  startedAt: now,
  lastObservedAt: now,
  createdAt: now,
  updatedAt: now,
  retentionExpiresAt: later,
};

const fingerprintData = {
  ...scope,
  userIntelligenceId: "bui_visitor_123456",
  sourceGateSessionId: "bgs_session_123456",
  fingerprintVersion: 1 as const,
  collectorVersion: "5.2.0" as const,
  components: {
    platform: { status: "available" as const, value: "Win32" },
    fonts: { status: "unavailable" as const },
  },
  serverObservedAt: now,
  firstObservedAt: now,
  lastObservedAt: now,
  createdAt: now,
  updatedAt: now,
  retentionExpiresAt: later,
};

describe("Phase 6 BotBlocker persistence contracts", () => {
  it("accepts complete and partially omitted raw current fingerprint vectors", () => {
    assert.equal(
      FingerprintDataRecordSchema.safeParse(fingerprintData).success,
      true,
    );
    assert.equal(
      FingerprintDataRecordSchema.safeParse({
        ...fingerprintData,
        components: {},
      }).success,
      true,
    );
  });

  it("keeps fingerprint persistence raw and its fields closed", () => {
    for (const field of [
      "visitorId",
      "confidence",
      "componentHash",
      "fingerprintHash",
      "stableFingerprintHash",
      "hashStatus",
      "hashRecipeVersion",
      "error",
      "duration",
      "cookies",
      "pageContent",
      "formValue",
      "email",
      "password",
      "query",
      "fragment",
      "clickedText",
      "rawKeystrokes",
      "pointerTrail",
    ]) {
      assert.equal(
        FingerprintDataRecordSchema.safeParse({
          ...fingerprintData,
          [field]: "prohibited",
        }).success,
        false,
        field,
      );
    }
  });

  it("accepts a scoped gate session with an IP observation and stale-update state", () => {
    assert.equal(GateSessionRecordSchema.safeParse(gateSession).success, true);
    assert.equal(
      GateSessionRecordSchema.safeParse({
        ...gateSession,
        tokenMetadata: {
          tokenId: "bvt_token_123456789",
          expiresAt: "2026-08-13T12:30:00.000Z",
          nonceDigest: "a".repeat(64),
          tokenDigest: "b".repeat(64),
        },
      }).success,
      true,
    );
  });

  it("requires customer, project, site, and intelligence scope", () => {
    const { projectId: _projectId, ...withoutProject } = gateSession;
    assert.equal(GateSessionRecordSchema.safeParse(withoutProject).success, false);
  });

  it("does not treat repeated IP addresses as identities", () => {
    const first = GateSessionRecordSchema.parse(gateSession);
    const second = GateSessionRecordSchema.parse({
      ...gateSession,
      gateSessionId: "bgs_session_654321",
      userIntelligenceId: "bui_visitor_654321",
      initialRequest: {
        ...initialRequest,
        request: {
          ...initialRequest.request,
          gateSessionId: "bgs_session_654321",
          payload: {
            ...initialRequest.request.payload,
            gateSessionId: "bgs_session_654321",
          },
        },
      },
    });

    assert.equal(first.ip, second.ip);
    assert.notEqual(first.userIntelligenceId, second.userIntelligenceId);
  });

  it("accepts a visitor intelligence aggregate without a risk score", () => {
    const intelligence = {
      ...scope,
      userIntelligenceId: "bui_visitor_123456",
      fingerprintVerifySource: { platformFamily: "windows" },
      fingerprintVerifyLookup: {
        recipeVersion: 1,
        status: "unavailable",
        reason: "missing_stable_inputs",
      },
      osCpu: "Windows NT 10.0",
      screenResolution: { width: 1920, height: 1080 },
      platform: "Win32",
      touchSupport: {
        maxTouchPoints: 0,
        touchEvent: false,
        touchStart: false,
      },
      vendor: "Google Inc.",
      architecture: 255,
      applePay: -1,
      currentIp: { ip, blacklisted: false },
      recentIpHistory: [{ ip: "198.51.100.9", asnScore: 10, blacklisted: false }],
      currentIpReuse: {
        global: {
          distinctProfiles1d: 1,
          distinctProfiles7d: 2,
          distinctProfiles30d: 3,
        },
        site: {
          distinctProfiles1d: 1,
          distinctProfiles7d: 1,
          distinctProfiles30d: 2,
        },
      },
      currentScore: { status: "available", score: 42.5 },
      latestEvidence: evidence,
      gateSessionCount: 2,
      behaviorReportCount: 3,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
    };

    assert.equal(UserIntelligenceRecordSchema.safeParse(intelligence).success, true);
    assert.equal(
      UserIntelligenceRecordSchema.safeParse({
        ...intelligence,
        passportUserId: "pus_passport_123456",
      }).success,
      true,
    );
    for (const field of [
      "components",
      "hardwareConcurrency",
      "deviceMemory",
      "colorDepth",
      "timezone",
      "fingerprintHash",
      "scoreHistory",
      "scoreModelVersion",
    ]) {
      assert.equal(
        UserIntelligenceRecordSchema.safeParse({
          ...intelligence,
          [field]: "not-an-approved-direct-field",
        }).success,
        false,
        field,
      );
    }
  });

  it("bounds recentIpHistory to 20 entries and requires monotonic reuse counts", () => {
    const base = {
      ...scope,
      userIntelligenceId: "bui_visitor_123456",
      recentIpHistory: [],
      gateSessionCount: 1,
      behaviorReportCount: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
    };
    const history = Array.from({ length: 20 }, (_, index) => ({
      ip: `198.51.100.${index}`,
      blacklisted: false,
    }));
    assert.equal(
      UserIntelligenceRecordSchema.safeParse({
        ...base,
        recentIpHistory: history,
      }).success,
      true,
    );
    assert.equal(
      UserIntelligenceRecordSchema.safeParse({
        ...base,
        recentIpHistory: [...history, { ip: "198.51.100.99", blacklisted: false }],
      }).success,
      false,
    );
    assert.equal(
      UserIntelligenceRecordSchema.safeParse({
        ...base,
        currentIpReuse: {
          global: { distinctProfiles1d: 3, distinctProfiles7d: 2, distinctProfiles30d: 5 },
          site: { distinctProfiles1d: 0, distinctProfiles7d: 0, distinctProfiles30d: 0 },
        },
      }).success,
      false,
    );
  });

  it("rejects browser-supplied scores and prohibited telemetry", () => {
    const forgedIntelligence = {
      ...scope,
      userIntelligenceId: "bui_visitor_123456",
      recentIpHistory: [],
      gateSessionCount: 1,
      behaviorReportCount: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
      score: 99,
    };
    const forbiddenEvidence = {
      ...evidence,
      rawKeystrokes: ["secret"],
    };
    const { score, ...validIntelligence } = forgedIntelligence;
    assert.equal(score, 99);

    assert.equal(
      UserIntelligenceRecordSchema.safeParse(forgedIntelligence).success,
      false,
    );
    assert.equal(
      UserIntelligenceRecordSchema.safeParse({
        ...validIntelligence,
        latestEvidence: forbiddenEvidence,
      }).success,
      false,
    );
  });

  it("binds behavior reports to the same gate session and sequence", () => {
    const record = {
      ...scope,
      riskEventId: "bre_event_12345678",
      userIntelligenceId: "bui_visitor_123456",
      gateSessionId: "bgs_session_123456",
      reportSequence: 0,
      eventIndex: 0 as const,
      recordType: "behavior_report" as const,
      pageUrl: "https://customer.example/products",
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
      report: {
        protocolVersion: 1 as const,
        sequence: {
          gateSessionId: "bgs_session_123456",
          sequence: 0,
          issuedAt: Date.parse(now),
        },
        trigger: "initial" as const,
        evidence,
      },
    };

    assert.equal(BehaviorReportEventRecordSchema.safeParse(record).success, true);
    assert.equal(
      BehaviorReportEventRecordSchema.safeParse({
        ...record,
        reportSequence: 1,
      }).success,
      false,
    );
    assert.equal(
      BehaviorReportEventRecordSchema.safeParse({
        ...record,
        pageUrl: "https://customer.example/products?secret=value",
      }).success,
      false,
    );
  });

  it("binds the complete initial request to the first immutable risk event", () => {
    const record = {
      ...scope,
      riskEventId: "bre_initial_12345678",
      userIntelligenceId: gateSession.userIntelligenceId,
      gateSessionId: gateSession.gateSessionId,
      reportSequence: -1 as const,
      eventIndex: 0 as const,
      recordType: "initial_request" as const,
      initialRequest,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
    };
    assert.equal(InitialRequestEventRecordSchema.safeParse(record).success, true);
    assert.equal(
      InitialRequestEventRecordSchema.safeParse({
        ...record,
        gateSessionId: "bgs_other_session_123",
      }).success,
      false,
    );
  });

  it("rejects retention expiry at the category anchor boundary", () => {
    assert.equal(
      GateSessionRecordSchema.safeParse({
        ...gateSession,
        retentionExpiresAt: gateSession.lastObservedAt,
      }).success,
      false,
    );
  });

  it("binds sanitized risk signals to an event index and report sequence", () => {
    const record = {
      ...scope,
      riskEventId: "bre_event_87654321",
      userIntelligenceId: "bui_visitor_123456",
      gateSessionId: "bgs_session_123456",
      reportSequence: 2,
      eventIndex: 1,
      recordType: "risk_signal" as const,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: later,
      sequence: {
        gateSessionId: "bgs_session_123456",
        sequence: 2,
        issuedAt: Date.parse(now),
      },
      event: {
        kind: "honeypot_activation" as const,
        occurredAt: Date.parse(now),
        honeypot: { honeypotId: "summary-decoy" },
      },
    };

    assert.equal(RiskSignalEventRecordSchema.safeParse(record).success, true);
    assert.equal(
      RiskSignalEventRecordSchema.safeParse({ ...record, eventIndex: 0 }).success,
      false,
    );
  });

  it("stores challenge lifecycle and optional authoritative OTP linkage", () => {
    assert.equal(
      BotBlockerChallengeRecordSchema.safeParse({
        ...scope,
        challengeId: "bbc_challenge_12345",
        userIntelligenceId: "bui_visitor_123456",
        gateSessionId: "bgs_session_123456",
        state: "completed",
        verificationType: "email_code",
        verificationRequestId: "ver_request_123456",
        verificationResult: "succeeded",
        issuedAt: now,
        expiresAt: "2026-08-13T12:05:00.000Z",
        completedAt: "2026-08-13T12:02:00.000Z",
        createdAt: now,
        updatedAt: now,
        retentionExpiresAt: later,
      }).success,
      true,
    );
  });

  it("enforces prohibited fields at compile time", () => {
    const forgedFingerprint: FingerprintDataRecord = {
      ...FingerprintDataRecordSchema.parse(fingerprintData),
      // @ts-expect-error FingerprintJS authority never persists
      visitorId: "browser-authority",
    };
    const forgedSession: GateSessionRecord = {
      ...gateSession,
      // @ts-expect-error raw page content is never a persistence field
      pageContent: "<html>secret</html>",
    };
    const forgedIntelligence: UserIntelligenceRecord = {
      ...UserIntelligenceRecordSchema.parse({
        ...scope,
        userIntelligenceId: "bui_visitor_123456",
        fingerprintVerifySource: { platformFamily: "windows" },
        fingerprintVerifyLookup: {
          recipeVersion: 1,
          status: "available",
          hash: verifyHash,
        },
        recentIpHistory: [],
        gateSessionCount: 0,
        behaviorReportCount: 0,
        firstObservedAt: now,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
        retentionExpiresAt: later,
      }),
      // @ts-expect-error scoring is Phase 17, not caller-supplied state
      score: 1,
    };

    assert.equal("pageContent" in forgedSession, true);
    assert.equal("score" in forgedIntelligence, true);
    assert.equal("visitorId" in forgedFingerprint, true);
  });
});
