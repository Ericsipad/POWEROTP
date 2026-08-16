import type {
  BotBlockerSiteConfiguration,
  UpdateBotBlockerSiteConfiguration,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import type {
  AuditDocument,
  ProjectDocument,
} from "./persistence.js";
import { ProjectError } from "./project-service.js";
import { createId } from "./security.js";

export interface RuntimeBotBlockerSite {
  customerId: string;
  projectId: string;
  siteId: string;
  webhookId: string;
  enabled: boolean;
  projectActive: boolean;
  allowedOrigins: string[];
}

export class BotBlockerSiteService {
  readonly #sites;
  readonly #projects;
  readonly #audits;

  constructor(db: Db) {
    this.#sites = db.collection<BotBlockerSiteDocument>("botblockerSites");
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async get(
    customerId: string,
    projectId: string,
  ): Promise<BotBlockerSiteConfiguration> {
    await this.#assertOwned(customerId, projectId);
    const site = await this.#sites.findOne({ projectId, customerId });
    if (!site) throw new ProjectError("botblocker_site_not_found", 404);
    return toResponse(site);
  }

  async resolveRuntimeSite(scope: {
    projectId: string;
    siteId: string;
    webhookId: string;
  }): Promise<RuntimeBotBlockerSite | undefined> {
    const site = await this.#sites.findOne({
      _id: scope.siteId,
      projectId: scope.projectId,
      webhookId: scope.webhookId,
    });
    if (!site) return undefined;
    const project = await this.#projects.findOne({
      _id: scope.projectId,
      customerId: site.customerId,
    });
    if (!project) return undefined;
    return {
      customerId: site.customerId,
      projectId: project._id,
      siteId: site._id,
      webhookId: site.webhookId,
      enabled: site.enabled,
      projectActive: project.active,
      allowedOrigins: project.allowedOrigins,
    };
  }

  async update(
    customerId: string,
    projectId: string,
    input: UpdateBotBlockerSiteConfiguration,
    ip?: string,
  ): Promise<BotBlockerSiteConfiguration> {
    const existing = await this.get(customerId, projectId);
    const now = new Date();
    const site = await this.#sites.findOneAndUpdate(
      { _id: existing.siteId, projectId, customerId },
      {
        $set: { ...input, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (!site) throw new Error("BotBlocker site update returned no document");

    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId: customerId,
      action: "botblocker_site.updated",
      targetType: "botblocker_site",
      targetId: site._id,
      occurredAt: now,
      ip,
      details: input,
    });
    return toResponse(site);
  }

  async #assertOwned(customerId: string, projectId: string): Promise<void> {
    const project = await this.#projects.findOne({ _id: projectId, customerId });
    if (!project) throw new ProjectError("project_not_found", 404);
  }
}

function toResponse(site: BotBlockerSiteDocument): BotBlockerSiteConfiguration {
  return {
    siteId: site._id,
    projectId: site.projectId,
    webhookId: site.webhookId,
    enabled: site.enabled,
    decisionTimeoutMs: site.decisionTimeoutMs,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}
