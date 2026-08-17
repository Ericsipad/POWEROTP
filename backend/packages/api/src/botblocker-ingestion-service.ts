import { createHmac } from "node:crypto";

import {
  BehaviorReportSchema,
  BrowserEvidenceSchema,
  RiskEventBatchSchema,
  type BehaviorReport,
  type BotBlockerDecisionOutcome,
  type BrowserEvidence,
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
  | "openGateSession"
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
    evidence: BrowserEvidence;
    trustedClientIp?: string;
    /** Already-resolved fast-immediate-branch network intelligence
     * (Phase 16 step 7's `rapidAuthMutation` wiring) to land on the gate
     * session row at creation time. Absent for every other caller of this
     * method (e.g. the browser-assessment late-session-creation fallback),
     * which never resolved that chain. */
    latestDecision?: BotBlockerDecisionOutcome;
    networkClassification?: GateSessionNetworkClassification;
    ipReputation?: GateSessionIpReputation;
  }) {
    const evidence = parseEvidence(input.evidence);
    const now = this.now();
    try {
      return await this.persistence.openGateSession({
        scope: input.scope,
        gateSessionId: input.gateSessionId,
        fingerprintHash: this.#fingerprintHash(evidence),
        ...(input.trustedClientIp
          ? { ip: this.#normalizedIp(input.trustedClientIp) }
          : {}),
        ...(input.latestDecision ? { latestDecision: input.latestDecision } : {}),
        ...(input.networkClassification
          ? { networkClassification: input.networkClassification }
          : {}),
        ...(input.ipReputation ? { ipReputation: input.ipReputation } : {}),
        evidence,
        now,
      });
    } catch (error) {
      if (error instanceof BotBlockerIngestionPersistenceError) {
        throw new BotBlockerRuntimeError("invalid_request", 404);
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
    let gateSession = await this.persistence.findGateSession(
      scope,
      report.sequence.gateSessionId,
    );
    if (!gateSession) {
      gateSession = await this.startSession({
        scope,
        gateSessionId: report.sequence.gateSessionId,
        evidence: report.evidence,
      });
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

  #fingerprintHash(evidence: BrowserEvidence): string {
    if (!this.#hashSecret) {
      throw new BotBlockerRuntimeError(
        "dependency_unavailable",
        503,
        true,
      );
    }
    return createHmac("sha256", this.#hashSecret)
      .update(`botblocker-fingerprint-v1\0${JSON.stringify(evidence)}`)
      .digest("hex");
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

function parseEvidence(candidate: BrowserEvidence): BrowserEvidence {
  const parsed = BrowserEvidenceSchema.safeParse(candidate);
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
