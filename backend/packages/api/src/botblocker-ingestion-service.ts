import {
  CanonicalReportRequestSchema,
  type BotBlockerDecisionOutcome,
  type BotBlockerSessionDataResponse,
  type CanonicalReportRequest,
} from "@powerotp/contracts";

import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import {
  BotBlockerIngestionPersistence,
  BotBlockerIngestionPersistenceError,
  type BotBlockerIngestionResult,
} from "./botblocker-ingestion-persistence.js";
import type {
  BotBlockerScope,
  GateSessionIpReputation,
  GateSessionNetworkClassification,
} from "./botblocker-intelligence-persistence.js";
import type { AuthenticatedBotBlockerSite } from "./botblocker-site-credential-service.js";
import type { ProductionConfig } from "./config.js";
import { normalizeIp } from "./ip-utils.js";

const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1_000;

type IngestionStore = Pick<
  BotBlockerIngestionPersistence,
  | "findGateSession"
  | "findCurrentSessionData"
  | "openGateSession"
  | "saveVisitorTokenMetadata"
  | "ingestReport"
>;

export interface CanonicalReportDerivedEvidence {
  ipBlacklisted?: boolean;
  latestDecision?: BotBlockerDecisionOutcome;
  networkClassification?: GateSessionNetworkClassification;
  ipReputation?: GateSessionIpReputation;
}

export class BotBlockerIngestionService {
  readonly #hashSecret: string | undefined;

  constructor(
    private readonly persistence: IngestionStore,
    config: Pick<ProductionConfig, "BOTBLOCKER_INTELLIGENCE_HASH_SECRET">,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#hashSecret = config.BOTBLOCKER_INTELLIGENCE_HASH_SECRET;
  }

  async ingestReport(
    site: AuthenticatedBotBlockerSite,
    candidate: CanonicalReportRequest,
    derived: CanonicalReportDerivedEvidence = {},
  ): Promise<BotBlockerIngestionResult> {
    const report = parseReport(candidate);
    const now = this.now();
    if (!site.allowedOrigins.includes(report.audience)) {
      throw new BotBlockerRuntimeError("audience_mismatch", 403);
    }
    this.#requireCurrentTimestamp(report.issuedAt, now);
    for (const signal of report.payload.riskSignals ?? []) {
      this.#requireCurrentTimestamp(signal.occurredAt, now);
    }

    const scope = scopeFor(site);
    if (report.reportSequence === -1) {
      return this.#openSession(scope, report, derived, now);
    }
    const gateSession = await this.persistence.findGateSession(
      scope,
      report.gateSessionId,
    );
    if (!gateSession) {
      throw new BotBlockerRuntimeError("invalid_request", 404);
    }
    try {
      const result = await this.persistence.ingestReport(
        scope,
        report,
        derived,
        pageUrl(report),
        now,
      );
      if (result === "stale") throw staleSequence();
      return result;
    } catch (error) {
      if (error instanceof BotBlockerIngestionPersistenceError) {
        throw persistenceError(error);
      }
      throw error;
    }
  }

  async saveVisitorTokenMetadata(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    metadata: {
      tokenId: string;
      expiresAt: Date;
      nonceDigest: string;
      tokenDigest: string;
    };
  }): Promise<void> {
    try {
      await this.persistence.saveVisitorTokenMetadata({
        ...input,
        now: this.now(),
      });
    } catch (error) {
      if (error instanceof BotBlockerIngestionPersistenceError) {
        throw persistenceError(error);
      }
      throw error;
    }
  }

  async getCurrentSessionData(
    site: AuthenticatedBotBlockerSite,
    gateSessionId: string,
    eventId: string,
  ): Promise<BotBlockerSessionDataResponse> {
    const scope = scopeFor(site);
    const data = await this.persistence.findCurrentSessionData(
      scope,
      gateSessionId,
    );
    if (!data) {
      throw new BotBlockerRuntimeError("invalid_request", 404);
    }
    return {
      apiVersion: "2026-08-04",
      eventId,
      projectId: site.projectId,
      siteId: site.siteId,
      gateSessionId,
      ...data,
      updatedAt: data.updatedAt.toISOString(),
    };
  }

  async #openSession(
    scope: BotBlockerScope,
    report: CanonicalReportRequest,
    derived: CanonicalReportDerivedEvidence,
    now: Date,
  ): Promise<BotBlockerIngestionResult> {
    const requestIp = report.payload.request?.clientIp;
    try {
      const existing = await this.persistence.findGateSession(
        scope,
        report.gateSessionId,
      );
      const session = await this.persistence.openGateSession({
        scope,
        gateSessionId: report.gateSessionId,
        initialReport: report,
        ...(this.#hashSecret ? { verifyHashSecret: this.#hashSecret } : {}),
        ...(requestIp ? { ip: this.#normalizedIp(requestIp) } : {}),
        ...derived,
        now,
      });
      return existing && session._id === existing._id ? "duplicate" : "accepted";
    } catch (error) {
      if (error instanceof BotBlockerIngestionPersistenceError) {
        throw persistenceError(error);
      }
      throw error;
    }
  }

  #normalizedIp(value: string): string {
    const normalized = normalizeIp(value);
    if (!normalized) throw new BotBlockerRuntimeError("invalid_request", 400);
    return normalized;
  }

  #requireCurrentTimestamp(value: number, now: Date): void {
    if (
      !Number.isSafeInteger(value) ||
      value > now.getTime() + MAX_EVENT_CLOCK_SKEW_MS
    ) {
      throw new BotBlockerRuntimeError("invalid_request", 400);
    }
  }
}

function parseReport(candidate: CanonicalReportRequest): CanonicalReportRequest {
  const parsed = CanonicalReportRequestSchema.safeParse(candidate);
  if (!parsed.success) throw new BotBlockerRuntimeError("invalid_request", 400);
  return parsed.data;
}

function scopeFor(site: AuthenticatedBotBlockerSite): BotBlockerScope {
  return {
    customerId: site.customerId,
    projectId: site.projectId,
    siteId: site.siteId,
  };
}

function pageUrl(report: CanonicalReportRequest): string | undefined {
  const routePath = report.payload.behaviorReport?.evidence.routePath ??
    report.payload.browserEvidence?.routePath;
  if (!routePath) return undefined;
  try {
    return new URL(routePath, new URL(report.audience).origin).toString();
  } catch {
    throw new BotBlockerRuntimeError("invalid_request", 400);
  }
}

function staleSequence(): BotBlockerRuntimeError {
  return new BotBlockerRuntimeError("stale_sequence", 409);
}

function persistenceError(
  error: BotBlockerIngestionPersistenceError,
): BotBlockerRuntimeError {
  return error.code === "conflicting_replay" ||
      error.code === "stale_initial_request"
    ? staleSequence()
    : new BotBlockerRuntimeError("invalid_request", 404);
}
