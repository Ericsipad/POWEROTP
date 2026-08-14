import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import {
  BotBlockerIntelligencePersistence,
} from "./botblocker-intelligence-persistence.js";
import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import type {
  AuditDocument,
  ProjectDocument,
} from "./persistence.js";
import { ProjectError } from "./project-service.js";
import { createId } from "./security.js";

export class BotBlockerOperationsService {
  readonly #intelligence: Pick<
    BotBlockerIntelligencePersistence,
    | "findGateSessionById"
    | "listChallenges"
    | "listUserIntelligence"
    | "listRiskEvents"
  >;
  readonly #projects;
  readonly #sites;
  readonly #policyReleases;
  readonly #audits;

  constructor(
    db: Db,
    intelligence: Pick<
      BotBlockerIntelligencePersistence,
      | "findGateSessionById"
      | "listChallenges"
      | "listUserIntelligence"
      | "listRiskEvents"
    >,
    private readonly dependenciesReady: () => Promise<boolean>,
    private readonly config: Pick<
      ProductionConfig,
      | "BOTBLOCKER_ED25519_ACTIVE_KEY_ID"
      | "BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET"
      | "BOTBLOCKER_RUNTIME_ORIGIN"
    >,
  ) {
    this.#intelligence = intelligence;
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#sites = db.collection<BotBlockerSiteDocument>("botblockerSites");
    this.#policyReleases = db.collection("policyReleases");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async visitors(
    customerId: string,
    projectId: string,
    options: { limit: number; before?: Date; siteId?: string },
  ) {
    const project = await this.#projects.findOne({ _id: projectId, customerId });
    if (!project) throw new ProjectError("project_not_found", 404);
    const site = await this.#sites.findOne({ projectId, customerId });
    if (!site) return { visitors: [], nextCursor: undefined };
    if (options.siteId && options.siteId !== site._id) {
      throw new ProjectError("project_not_found", 404);
    }
    const visitors = await this.#intelligence.listUserIntelligence(
      { customerId, projectId, siteId: site._id },
      options,
    );
    return {
      visitors: visitors.map((visitor) => ({
        visitorId: visitor._id,
        siteId: visitor.siteId,
        gateSessionCount: visitor.gateSessionCount,
        behaviorReportCount: visitor.behaviorReportCount,
        firstObservedAt: visitor.firstObservedAt.toISOString(),
        lastObservedAt: visitor.lastObservedAt.toISOString(),
      })),
      nextCursor:
        visitors.length === options.limit
          ? visitors.at(-1)?.lastObservedAt.toISOString()
          : undefined,
    };
  }

  async decisionTrace(
    actorId: string,
    gateSessionId: string,
    ip?: string,
  ) {
    const session = await this.#intelligence.findGateSessionById(gateSessionId);
    if (!session) throw new ProjectError("gate_session_not_found", 404);
    const scope = {
      customerId: session.customerId,
      projectId: session.projectId,
      siteId: session.siteId,
    };
    const [events, challenges] = await Promise.all([
      this.#intelligence.listRiskEvents(scope, gateSessionId),
      this.#intelligence.listChallenges(scope, gateSessionId),
    ]);
    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId,
      action: "botblocker_decision_trace.viewed",
      targetType: "botblocker_gate_session",
      targetId: gateSessionId,
      occurredAt: new Date(),
      ip,
    });
    return {
      entries: [
        ...events.map((event) => ({
          traceId: event._id,
          gateSessionId,
          stage: "risk_event" as const,
          reasonCode: event.recordType,
          occurredAt: event.occurredAt.toISOString(),
        })),
        ...challenges.map((challenge) => ({
          traceId: challenge._id,
          gateSessionId,
          stage: "challenge" as const,
          reasonCode: challenge.verificationResult ?? challenge.state,
          occurredAt: challenge.issuedAt.toISOString(),
        })),
      ].sort((left, right) =>
        left.occurredAt.localeCompare(right.occurredAt),
      ),
      nextCursor: undefined,
    };
  }

  async health() {
    const [dependencies, policyReleaseCount] = await Promise.all([
      this.dependenciesReady(),
      this.#policyReleases.countDocuments(),
    ]);
    const credentialAuthentication = Boolean(
      this.config.BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET &&
        this.config.BOTBLOCKER_RUNTIME_ORIGIN,
    );
    const policySigning = Boolean(
      this.config.BOTBLOCKER_ED25519_ACTIVE_KEY_ID,
    );
    const checkedAt = new Date().toISOString();
    const states = {
      mongodb_valkey: dependencies ? "healthy" : "unavailable",
      credential_authentication: credentialAuthentication
        ? "healthy"
        : "unavailable",
      policy_signing: policySigning ? "healthy" : "unavailable",
      policy_releases: policyReleaseCount > 0 ? "healthy" : "degraded",
    } as const;
    const values = Object.values(states);
    return {
      state: values.includes("unavailable")
        ? "unavailable"
        : values.includes("degraded")
          ? "degraded"
          : "healthy",
      checkedAt,
      dependencies: Object.entries(states).map(([name, state]) => ({
        name,
        state,
        checkedAt,
      })),
    };
  }
}
