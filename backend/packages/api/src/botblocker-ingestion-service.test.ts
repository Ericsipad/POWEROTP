import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  BrowserEvidence,
  CanonicalReportRequest,
  FingerprintVector,
} from "@powerotp/contracts";

import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import {
  BotBlockerIngestionPersistenceError,
  type BotBlockerIngestionResult,
} from "./botblocker-ingestion-persistence.js";
import { BotBlockerIngestionService } from "./botblocker-ingestion-service.js";
import type {
  BotBlockerScope,
  CanonicalReportServerEvidence,
  GateSessionDocument,
} from "./botblocker-intelligence-persistence.js";

const now = new Date("2026-08-16T04:00:00.000Z");
const hashSecret = "intelligence-hash-secret-at-least-32-characters";
const audience = "https://owner.example";
const owner = {
  customerId: "usr_owner_123456",
  projectId: "prj_owner_123456789",
  siteId: "bbs_owner_123456789",
  enabled: true,
  allowedOrigins: [audience],
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
  };
}

function fingerprint(): FingerprintVector {
  return {
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: { platform: { status: "available", value: "Win32" } },
  };
}

function initialReport(
  gateSessionId = "bgs_session_123456789",
  clientIp = "203.0.113.5",
): CanonicalReportRequest {
  return {
    protocolVersion: 1,
    siteId: owner.siteId,
    gateSessionId,
    audience,
    reportSequence: -1,
    nonce: "nonce_initial_request_123456",
    issuedAt: now.getTime(),
    payload: {
      request: {
        siteId: owner.siteId,
        clientIp,
        method: "GET",
        path: "/checkout",
      },
      browserEvidence: evidence(),
      fingerprint: fingerprint(),
      proofs: {},
    },
  };
}

function laterReport(
  sequence: number,
  gateSessionId = "bgs_session_123456789",
): CanonicalReportRequest {
  const reportSequence = {
    gateSessionId,
    sequence,
    issuedAt: now.getTime(),
  };
  return {
    protocolVersion: 1,
    siteId: owner.siteId,
    gateSessionId,
    audience,
    reportSequence: sequence,
    nonce: `nonce_later_report_${sequence}_123456`,
    issuedAt: now.getTime(),
    payload: {
      behaviorReport: {
        protocolVersion: 1,
        trigger: sequence === 0 ? "initial" : "recurring",
        sequence: reportSequence,
        evidence: evidence(),
      },
      riskSignals: [{
        kind: "honeypot_activation",
        occurredAt: now.getTime(),
        honeypot: { honeypotId: "decoy-link" },
      }],
    },
  };
}

class MemoryIngestionStore {
  readonly sessions = new Map<string, GateSessionDocument>();
  readonly reports = new Map<string, CanonicalReportRequest>();
  readonly pageUrls: (string | undefined)[] = [];
  opened: Parameters<MemoryIngestionStore["openGateSession"]>[0][] = [];

  findGateSession(scope: BotBlockerScope, gateSessionId: string) {
    const session = this.sessions.get(gateSessionId);
    return Promise.resolve(session && sameScope(session, scope) ? session : null);
  }

  async findCurrentSessionData(
    scope: BotBlockerScope,
    gateSessionId: string,
  ) {
    const session = await this.findGateSession(scope, gateSessionId);
    return session
      ? {
          currentScore: { status: "available" as const, score: 42 },
          updatedAt: session.updatedAt,
        }
      : undefined;
  }

  openGateSession(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    initialReport: CanonicalReportRequest;
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
      initialReport: {
        report: input.initialReport,
        serverEvidence: {
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

  ingestReport(
    scope: BotBlockerScope,
    value: CanonicalReportRequest,
    _serverEvidence: CanonicalReportServerEvidence,
    pageUrl: string | undefined,
  ): Promise<BotBlockerIngestionResult> {
    const session = this.sessions.get(value.gateSessionId);
    if (!session || !sameScope(session, scope)) return Promise.resolve("stale");
    const key = `${value.gateSessionId}:${value.reportSequence}`;
    const existing = this.reports.get(key);
    if (existing) {
      return Promise.resolve(
        JSON.stringify(existing) === JSON.stringify(value)
          ? "duplicate"
          : "stale",
      );
    }
    if (value.reportSequence <= session.lastAppliedSequence) {
      return Promise.resolve("stale");
    }
    session.lastAppliedSequence = value.reportSequence;
    this.reports.set(key, value);
    this.pageUrls.push(pageUrl);
    return Promise.resolve("accepted");
  }
}

describe("BotBlockerIngestionService", () => {
  it("opens the initial canonical report idempotently with raw fingerprint and IP", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    const report = initialReport(
      "bgs_hash_one_123456",
      "2001:0DB8:0:0::1",
    );

    assert.equal(await service.ingestReport(owner, report), "accepted");
    assert.equal(await service.ingestReport(owner, report), "duplicate");
    assert.equal(store.sessions.size, 1);
    assert.deepEqual(
      store.opened[0]!.initialReport.payload.fingerprint,
      fingerprint(),
    );
    assert.equal(store.opened[0]!.ip, "2001:db8::1");
    assert.equal(store.opened[0]!.verifyHashSecret, hashSecret);
  });

  it("ingests one ordered row containing behavior and risk signals", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.ingestReport(owner, initialReport());

    assert.equal(await service.ingestReport(owner, laterReport(0)), "accepted");
    assert.equal(await service.ingestReport(owner, laterReport(0)), "duplicate");
    assert.equal(store.reports.size, 1);
    assert.equal(store.reports.values().next().value?.payload.riskSignals?.length, 1);
    assert.deepEqual(store.pageUrls, ["https://owner.example/checkout"]);
  });

  it("rejects stale, cross-scope, and prohibited input without re-opening the session", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    await service.ingestReport(owner, initialReport());
    await service.ingestReport(owner, laterReport(2));

    await assert.rejects(
      service.ingestReport(owner, laterReport(1)),
      isRuntimeError("stale_sequence"),
    );
    await assert.rejects(
      service.ingestReport(otherProject, laterReport(3)),
      isRuntimeError("invalid_request"),
    );
    assert.equal(
      await service.ingestReport(owner, {
        ...laterReport(3),
        payload: {
          browserEvidence: evidence(),
          fingerprint: fingerprint(),
          proofs: {},
        },
      }),
      "accepted",
    );
    assert.equal(store.opened.length, 1);
    await assert.rejects(
      service.ingestReport(owner, {
        ...laterReport(3),
        payload: {
          behaviorReport: {
            ...laterReport(3).payload.behaviorReport!,
            evidence: {
              ...evidence(),
              fingerprintHash: "browser-supplied",
            },
          },
        },
      } as CanonicalReportRequest),
      isRuntimeError("invalid_request"),
    );
  });

  it("accepts a report with no evidence without fabricating fields", async () => {
    const store = new MemoryIngestionStore();
    const service = createService(store);
    const report = { ...initialReport(), payload: {} };
    assert.equal(await service.ingestReport(owner, report), "accepted");
    assert.deepEqual(store.opened[0]!.initialReport.payload, {});
    assert.equal(store.opened[0]!.ip, undefined);
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

function isRuntimeError(code: string) {
  return (error: unknown) =>
    error instanceof BotBlockerRuntimeError && error.code === code;
}
