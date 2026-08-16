import {
  DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
  type BotBlockerSiteConfiguration,
  type UpdateBotBlockerSiteConfiguration,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import type {
  AuditDocument,
  ProjectDocument,
} from "./persistence.js";
import { ProjectError } from "./project-service.js";
import { createId } from "./security.js";

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
    return this.ensure(customerId, projectId);
  }

  /**
   * Idempotently provisions the durable site row (and its `webhookId`)
   * without an ownership check, so it can be called during project
   * creation before any customer session context exists. Safe to call
   * repeatedly — later calls return the same row unchanged. Customer-facing
   * reads must go through `get()`, which enforces ownership first.
   */
  async ensure(
    customerId: string,
    projectId: string,
  ): Promise<BotBlockerSiteConfiguration> {
    const now = new Date();
    const site = await this.#sites.findOneAndUpdate(
      { projectId, customerId },
      {
        $setOnInsert: {
          _id: createId("bbs"),
          projectId,
          customerId,
          webhookId: createId("bwh"),
          ...DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!site) throw new Error("BotBlocker site upsert returned no document");
    return toResponse(site);
  }

  /**
   * Anonymous, project-scoped resolution for the runtime routes' URL
   * `webhookId` segment. Never used for authorization by itself — see
   * `BotBlockerWebhookIdSchema`'s doc comment — only to reject a request
   * whose path doesn't correspond to a real site before running any
   * credential/body auth.
   */
  findByWebhookId(webhookId: string) {
    return this.#sites.findOne({ webhookId });
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
