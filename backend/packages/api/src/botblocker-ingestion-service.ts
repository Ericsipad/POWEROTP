import {
  BehaviorReportSchema,
  RapidAuthRequestSchema,
  RiskEventBatchSchema,
  type BehaviorReport,
  type BotBlockerDecisionOutcome,
  type BotBlockerSessionDataResponse,
  type RapidAuthRequest,
  type RiskEventBatch,
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
  | "ingestBehaviorReport"
  | "ingestRiskEvents"
>;

export class BotBlockerIngestionService {
  readonly #hashSecret: string | undefined;

  constructor(
    private readonly persistence: IngestionStore,
    config: Pick<ProductionConfig, "BOTBLOCKER_INTELLIGENCE_HASH_SECRET">,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#hashSecret = config.BOTBLOCKER_INTELLIGENCE_HASH_SECRET;
  }

  async startSession(input: {
    scope: BotBlockerScope;
    gateSessionId: string;
    initialRequest: RapidAuthRequest;
    /** Trusted server-held binding only; never copied from browser evidence. */
    authoritativeUserIntelligenceId?: string;
    ipBlacklisted?: boolean;
    /** Already-resolved fast-immediate-branch network intelligence
     * (Phase 16 step 7's `rapidAuthMutation` wiring) to land on the gate
     * session row at creation time. Absent for every other caller of this
     * method (e.g. the browser-assessment late-session-creation fallback),
     * which never resolved that chain. */
    latestDecision?: BotBlockerDecisionOutcome;
    networkClassification?: GateSessionNetworkClassification;
    ipReputation?: GateSessionIpReputation;
  }) {
    const initialRequest = parseInitialRequest(input.initialRequest);
    const now = this.now();
    if (
      initialRequest.siteId !== input.scope.siteId ||
      initialRequest.gateSessionId !== input.gateSessionId
    ) {
      throw new BotBlockerRuntimeError("invalid_request", 400);
    }
    this.#requireCurrentTimestamp(initialRequest.issuedAt, now);
    try {
      return await this.persistence.openGateSession({
        scope: input.scope,
        gateSessionId: input.gateSessionId,
        initialRequest,
        ...(this.#hashSecret ? { verifyHashSecret: this.#hashSecret } : {}),
        ...(input.authoritativeUserIntelligenceId
          ? {
            authoritativeUserIntelligenceId:
              input.authoritativeUserIntelligenceId,
          }
          : {}),
        ...(initialRequest.payload.request.clientIp
          ? { ip: this.#normalizedIp(initialRequest.payload.request.clientIp) }
          : {}),
        ...(input.ipBlacklisted !== undefined
          ? { ipBlacklisted: input.ipBlacklisted }
          : {}),
        ...(input.latestDecision ? { latestDecision: input.latestDecision } : {}),
        ...(input.networkClassification
          ? { networkClassification: input.networkClassification }
          : {}),
        ...(input.ipReputation ? { ipReputation: input.ipReputation } : {}),
        now,
      });
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

  async ingestBrowserAssessment(
    site: AuthenticatedBotBlockerSite,
    candidate: BehaviorReport,
    audience: string,
  ): Promise<BotBlockerIngestionResult> {
    const report = parseBehaviorReport(candidate);
    const now = this.now();
    if (!site.allowedOrigins.includes(audience)) {
      throw new BotBlockerRuntimeError("audience_mismatch", 403);
    }
    this.#requireCurrentTimestamp(report.sequence.issuedAt, now);
    const scope = scopeFor(site);
    const gateSession = await this.persistence.findGateSession(
      scope,
      report.sequence.gateSessionId,
    );
    if (!gateSession) {
      throw new BotBlockerRuntimeError("invalid_request", 404);
    }
    const result = await this.persistence.ingestBehaviorReport(
      scope,
      report,
      pageUrl(audience, report.evidence.routePath),
      now,
    );
    if (result === "stale") throw staleSequence();
    return result;
  }

  async ingestRiskEvents(
    site: AuthenticatedBotBlockerSite,
    candidate: RiskEventBatch,
  ): Promise<BotBlockerIngestionResult> {
    const batch = parseRiskEventBatch(candidate);
    const now = this.now();
    if (batch.siteId !== site.siteId) {
      throw new BotBlockerRuntimeError("invalid_request", 400);
    }
    this.#requireCurrentTimestamp(batch.sequence.issuedAt, now);
    for (const event of batch.events) {
      this.#requireCurrentTimestamp(event.occurredAt, now);
    }
    const scope = scopeFor(site);
    const gateSession = await this.persistence.findGateSession(
      scope,
      batch.sequence.gateSessionId,
    );
    if (!gateSession) {
      throw new BotBlockerRuntimeError("invalid_request", 404);
    }
    const result = await this.persistence.ingestRiskEvents(scope, batch, now);
    if (result === "stale") throw staleSequence();
    return result;
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

function parseInitialRequest(candidate: RapidAuthRequest): RapidAuthRequest {
  const parsed = RapidAuthRequestSchema.safeParse(candidate);
  if (!parsed.success) throw new BotBlockerRuntimeError("invalid_request", 400);
  return parsed.data;
}

function parseBehaviorReport(candidate: BehaviorReport): BehaviorReport {
  const parsed = BehaviorReportSchema.safeParse(candidate);
  if (!parsed.success) throw new BotBlockerRuntimeError("invalid_request", 400);
  return parsed.data;
}

function parseRiskEventBatch(candidate: RiskEventBatch): RiskEventBatch {
  const parsed = RiskEventBatchSchema.safeParse(candidate);
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

function pageUrl(audience: string, routePath: string): string {
  try {
    const origin = new URL(audience).origin;
    return new URL(routePath, origin).toString();
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
