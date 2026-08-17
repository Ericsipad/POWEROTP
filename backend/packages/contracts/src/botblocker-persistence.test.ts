import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  GateSessionRecord,
  UserIntelligenceRecord,
} from "./botblocker-persistence.js";
import {
  BehaviorReportEventRecordSchema,
  BotBlockerChallengeRecordSchema,
  GateSessionRecordSchema,
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
const fingerprintHash = "a".repeat(64);
const ip = "203.0.113.5";
const evidence = {
  routePath: "/products",
  clicks: [{ category: "button" as const, powerOtpId: "add-to-cart" }],
  mouseDirectness: { averageDirectnessRatio: 0.7, sampleCount: 2 },
  scroll: { smoothnessScore: 0.8, highSpeedEventCount: 1 },
  honeypotActivations: [],
};

const gateSession = {
  ...scope,
  gateSessionId: "bgs_session_123456",
  userIntelligenceId: "bui_visitor_123456",
  fingerprintHash,
  ip,
  state: "active" as const,
  lastAppliedSequence: -1,
  startedAt: now,
  lastObservedAt: now,
  createdAt: now,
  updatedAt: now,
  retentionExpiresAt: later,
};

describe("Phase 6 BotBlocker persistence contracts", () => {
  it("accepts a scoped gate session with an IP observation and stale-update state", () => {
    assert.equal(GateSessionRecordSchema.safeParse(gateSession).success, true);
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
    });

    assert.equal(first.ip, second.ip);
    assert.notEqual(first.userIntelligenceId, second.userIntelligenceId);
  });

  it("accepts a visitor intelligence aggregate without a risk score", () => {
    const intelligence = {
      ...scope,
      userIntelligenceId: "bui_visitor_123456",
      fingerprintHash,
      ipObservations: [{
        ip,
        firstObservedAt: now,
        lastObservedAt: now,
        observationCount: 2,
      }],
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
  });

  it("rejects browser-supplied scores and prohibited telemetry", () => {
    const forgedIntelligence = {
      ...scope,
      userIntelligenceId: "bui_visitor_123456",
      fingerprintHash,
      ipObservations: [],
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
    const forgedSession: GateSessionRecord = {
      ...gateSession,
      // @ts-expect-error raw page content is never a persistence field
      pageContent: "<html>secret</html>",
    };
    const forgedIntelligence: UserIntelligenceRecord = {
      ...UserIntelligenceRecordSchema.parse({
        ...scope,
        userIntelligenceId: "bui_visitor_123456",
        fingerprintHash,
        ipObservations: [],
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
  });
});
