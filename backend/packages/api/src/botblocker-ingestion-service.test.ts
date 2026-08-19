import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  BehaviorReport,
  BrowserEvidence,
  FingerprintVector,
  RapidAuthRequest,
  RiskEventBatch,
} from "@powerotp/contracts";

import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import {
  BotBlockerIngestionPersistenceError,
  type BotBlockerIngestionResult,
} from "./botblocker-ingestion-persistence.js";
import { BotBlockerIngestionService } from "./botblocker-ingestion-service.js";
import type {
  BotBlockerScope,
  GateSessionDocument,
} from "./botblocker-intelligence-persistence.js";

const now = new Date("2026-08-16T04:00:00.000Z");
const hashSecret = "intelligence-hash-secret-at-least-32-characters";
const audience = "https://owner.example";
const owner = {
  customerId: "usr_owner",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
  enabled: true,
  allowedOrigins: ["https://owner.example"],
};
const otherProject = {
  ...owner,
  projectId: "prj_other_123456789",
  siteId: "bbs_other_123456789",
};

function evidence(): BrowserEvidence {
  return {
    routePath: "/checkout",
    clicks: [{ category: "button", powerOtpId: "continue" }],
    mouseDirectness: { averageDirectnessRatio: 0.75, sampleCount: 2 },
    scroll: { smoothnessScore: 0.8, highSpeedEventCount: 1 },
    honeypotActivations: [],
    environment: {
      evidenceVersion: 1,
      sensorVersion: "1.0.0",
      automationIndicators: [],
    },
    pageView: {
      pageId: "checkout",
      pageName: "Checkout",
      durationMs: 5_000,
      activeDurationMs: 4_900,
      documentWidth: 1_440,
      documentHeight: 3_200,
      pointerHeatmap: {
        gridSize: 32,
        bins: [{ column: 10, row: 20, sampleCount: 8, dwellMs: 600 }],
      },
    },
  };
}

function fingerprint(): FingerprintVector {
  return {
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: {
      platform: { status: "available", value: "Win32" },
    },
  };
}

function report(sequence: number): BehaviorReport {
  return {
    protocolVersion: 1,
    trigger: sequence === 0 ? "initial" : "recurring",
    sequence: {
      gateSessionId: "bgs_session_123456789",
      sequence,
      issuedAt: now.getTime(),
    },
    evidence: evidence(),
  };
}

function riskBatch(sequence: number): RiskEventBatch {
  return {
    protocolVersion: 1,
    siteId: owner.siteId,
    sequence: {
      gateSessionId: "bgs_session_123456789",
      sequence,
      issuedAt: now.getTime(),
    },
    events: [{
      kind: "honeypot_activation",
      occurredAt: now.getTime(),
      honeypot: { honeypotId: "decoy-link" },
    }],
  };
}

function rapidRequest(
  gateSessionId = "bgs_session_123456789",
  clientIp = "203.0.113.5",
): RapidAuthRequest {
  return {
    protocolVersion: 1,
    siteId: owner.siteId,
    gateSessionId,
    audience,
    nonce: "nonce_initial_request_123456",
    issuedAt: now.getTime(),
    payload: {
      gateSessionId,
      request: {
        siteId: owner.siteId,
        clientIp,
        method: "GET",
        path: "/checkout",
      },
      browser: {
        protocolVersion: 1,
        evidence: evidence(),
        fingerprint: fingerprint(),
        proofs: {},
      },
    },
  };
}

class MemoryIngestionStore {
  readonly sessions = new Map<string, GateSessionDocument>();
  readonly behaviorReports = new Map<string, BehaviorReport>();
  readonly pageUrls: string[] = [];
  readonly riskEvents = new Map<string, RiskEventBatch>();
  opened: Parameters<MemoryIngestionStore["openGateSession"]>[0][] = [];

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    const session = this.sessions.get(gateSessionId);
    return Promise.resolve(session && sameScope(session, scope) ? session : null);
  }

  openGateSession(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    initialRequest: RapidAuthRequest;
    verifyHashSecret?: string;
    ip?: string;
    ipBlacklisted?: boolean;
    now: Date;
  }) {
    const existing = this.sessions.get(input.gateSessionId);
    if (existing && !sameScope(existing, input.scope)) {
      throw new BotBlockerIngestionPersistenceError("scope_mismatch");
    }
    if (existing) return Promise.resolve(existing);
    this.opened.push(input);
    const session: GateSessionDocument = {
      _id: input.gateSessionId,
      ...input.scope,
      userIntelligenceId: `bui_${input.gateSessionId}`,
      initialRequest: {
        request: input.initialRequest,
        risk: {
          ...(input.ipBlacklisted !== undefined
            ? { ipBlacklisted: input.ipBlacklisted }
            : {}),
        },
        serverObservedAt: input.now,
      },
      ...(input.ip ? { ip: input.ip } : {}),
      state: "active",
      lastAppliedSequence: -1,
      startedAt: input.now,
      lastObservedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      retentionExpiresAt: new Date(input.now.getTime() + 90 * 86_400_000),
    };
    this.sessions.set(input.gateSessionId, session);
    return Promise.resolve(session);
  }

  saveVisitorTokenMetadata(input: {
    gateSessionId: string;
    metadata: NonNullable<GateSessionDocument["tokenMetadata"]>;
  }) {
    const session = this.sessions.get(input.gateSessionId);
    if (!session) {
      throw new BotBlockerIngestionPersistenceError("session_not_found");
    }
    session.tokenMetadata = input.metadata;
    return Promise.resolve();
  }

  ingestBehaviorReport(
    scope: BotBlockerScope,
    value: BehaviorReport,
    pageUrl: string,
  ): Promise<BotBlockerIngestionResult> {
    const session = this.sessions.get(value.sequence.gateSessionId);
    if (!session || !sameScope(session, scope)) return Promise.resolve("stale");
    const key = `${value.sequence.gateSessionId}:${value.sequence.sequence}`;
    const existing = this.behaviorReports.get(key);
    if (existing) {
      return Promise.resolve(
        JSON.stringify(existing) === JSON.stringify(value)
          ? "duplicate"
          : "stale",
      );
    }
    if (value.sequence.sequence <= session.lastAppliedSequence) {
      return Promise.resolve("stale");
    }
    session.lastAppliedSequence = value.sequence.sequence;
    this.behaviorReports.set(key, value);
    this.pageUrls.push(pageUrl);
    return Promise.resolve("accepted");
  }

  ingestRiskEvents(
    scope: BotBlockerScope,
    value: RiskEventBatch,
  ): Promise<BotBlockerIngestionResult> {
    const session = this.sessions.get(value.sequence.gateSessionId);
    if (!session || !sameScope(session, scope)) return Promise.resolve("stale");
    const key = `${value.sequence.gateSessionId}:${value.sequence.sequence}`;
    const existing = this.riskEvents.get(key);
    if (existing) {
      return Promise.resolve(
        JSON.stringify(existing) === JSON.stringify(value)
          ? "duplicate"
          : "stale",
      );
    }
    if (value.sequence.sequence <= session.lastAppliedSequence) {
      return Promise.resolve("stale");
    }
    session.lastAppliedSequence = value.sequence.sequence;
    this.riskEvents.set(key, value);
    return Promise.resolve("accepted");
  }
}

describe("BotBlockerIngestionService", () => {
  it("ingests duplicate browser reports idempotently and rejects stale reports", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.startSession({
      scope: owner,
      gateSessionId: report(1).sequence.gateSessionId,
      initialRequest: rapidRequest(),
    });

    assert.equal(
      await service.ingestBrowserAssessment(owner, report(1), audience),
      "accepted",
    );
    assert.equal(
      await service.ingestBrowserAssessment(owner, report(1), audience),
      "duplicate",
    );
    assert.equal(store.behaviorReports.size, 1);
    assert.deepEqual(store.pageUrls, ["https://owner.example/checkout"]);
    await assert.rejects(
      service.ingestBrowserAssessment(owner, report(0), audience),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "stale_sequence",
    );
  });

  it("ingests risk-event batches idempotently in the same ordered session stream", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.startSession({
      scope: owner,
      gateSessionId: report(0).sequence.gateSessionId,
      initialRequest: rapidRequest(),
    });

    assert.equal(await service.ingestRiskEvents(owner, riskBatch(1)), "accepted");
    assert.equal(await service.ingestRiskEvents(owner, riskBatch(1)), "duplicate");
    assert.equal(store.riskEvents.size, 1);
  });

  it("forwards the validated raw fingerprint and normalized raw IP", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.startSession({
      scope: owner,
      gateSessionId: "bgs_hash_one_123456",
      initialRequest: rapidRequest(
        "bgs_hash_one_123456",
        "2001:0DB8:0:0::1",
      ),
    });
    await service.startSession({
      scope: owner,
      gateSessionId: "bgs_hash_two_123456",
      initialRequest: rapidRequest(
        "bgs_hash_two_123456",
        "2001:db8::1",
      ),
    });

    assert.deepEqual(
      store.opened[0]!.initialRequest.payload.browser.fingerprint,
      fingerprint(),
    );
    assert.equal(store.opened[0]!.ip, "2001:db8::1");
    assert.equal(
      store.opened[0]!.verifyHashSecret,
      hashSecret,
    );
    assert.equal(store.opened[0]!.ip, store.opened[1]!.ip);
  });

  it("rejects prohibited raw fields before persistence", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    const unsafe = {
      ...report(0),
      evidence: {
        ...evidence(),
        fingerprintHash: "browser-supplied",
        pointerCoordinates: [[1, 2]],
      },
    } as unknown as BehaviorReport;

    await assert.rejects(
      service.ingestBrowserAssessment(owner, unsafe, audience),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "invalid_request",
    );
    assert.equal(store.sessions.size, 0);
    assert.equal(store.behaviorReports.size, 0);
  });

  it("does not resolve or create another project's visitor session", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.startSession({
      scope: owner,
      gateSessionId: report(0).sequence.gateSessionId,
      initialRequest: rapidRequest(),
    });

    await assert.rejects(
      service.ingestBrowserAssessment(otherProject, report(1), audience),
      (error: unknown) =>
        error instanceof BotBlockerRuntimeError &&
        error.code === "invalid_request" &&
        error.statusCode === 404,
    );
    assert.equal(store.sessions.size, 1);
  });

  it("does not discard raw session data when the verify key is absent", async () => {
    const store = new MemoryIngestionStore();
    const service = new BotBlockerIngestionService(
      store,
      {},
      () => now,
    );
    await service.startSession({
      scope: owner,
      gateSessionId: "bgs_no_secret_123456",
      initialRequest: rapidRequest("bgs_no_secret_123456"),
    });
    assert.deepEqual(
      store.opened[0]!.initialRequest.payload.browser.fingerprint,
      fingerprint(),
    );
    assert.equal(store.opened[0]!.verifyHashSecret, undefined);
  });
});

function createService(store: MemoryIngestionStore) {
  return new BotBlockerIngestionService(
    store,
    { BOTBLOCKER_INTELLIGENCE_HASH_SECRET: hashSecret },
    () => now,
  );
}

function sameScope(
  session: BotBlockerScope,
  scope: BotBlockerScope,
): boolean {
  return session.customerId === scope.customerId &&
    session.projectId === scope.projectId &&
    session.siteId === scope.siteId;
}
