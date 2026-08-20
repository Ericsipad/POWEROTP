import type {
  BotBlockerOtpMethodMarkers,
  BotBlockerSiteConfiguration,
  UpdateBotBlockerSiteConfiguration,
} from "@powerotp/contracts";
import { DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS } from "@powerotp/contracts";
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
    const markersChanged =
      input.otpMethodMarkers !== undefined &&
      !sameMarkers(existing.otpMethodMarkers, input.otpMethodMarkers);
    const enabledChanged =
      input.enabled !== undefined && input.enabled !== existing.enabled;
    const timeoutChanged =
      input.decisionTimeoutMs !== undefined &&
      input.decisionTimeoutMs !== existing.decisionTimeoutMs;
    if (!markersChanged && !enabledChanged && !timeoutChanged) return existing;

    const now = new Date();
    const changedSettings = {
      ...(enabledChanged ? { enabled: input.enabled } : {}),
      ...(timeoutChanged ? { decisionTimeoutMs: input.decisionTimeoutMs } : {}),
      ...(markersChanged
        ? { otpMethodMarkers: input.otpMethodMarkers?.map((marker) => ({ ...marker })) }
        : {}),
      updatedAt: now,
    };
    const site = await this.#sites.findOneAndUpdate(
      { _id: existing.siteId, projectId, customerId },
      {
        $set: changedSettings,
        ...(markersChanged ? { $inc: { otpPolicyVersion: 1 } } : {}),
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
      details: {
        ...(enabledChanged ? { enabled: site.enabled } : {}),
        ...(timeoutChanged ? { decisionTimeoutMs: site.decisionTimeoutMs } : {}),
        ...(markersChanged
          ? { otpPolicyVersion: site.otpPolicyVersion ?? 1 }
          : {}),
      },
    });
    if (markersChanged) {
      await this.#audits.insertOne({
        _id: createId("aud"),
        actorId: customerId,
        action: "botblocker_otp_policy.updated",
        targetType: "botblocker_site",
        targetId: site._id,
        occurredAt: now,
        ip,
        details: {
          previousVersion: existing.otpPolicyVersion,
          newVersion: site.otpPolicyVersion ?? existing.otpPolicyVersion + 1,
          previousMarkers: JSON.stringify(existing.otpMethodMarkers),
          newMarkers: JSON.stringify(site.otpMethodMarkers),
        },
      });
    }
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
    otpMethodMarkers: (
      site.otpMethodMarkers ?? DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS
    ).map((marker) => ({ ...marker })),
    otpPolicyVersion: site.otpPolicyVersion ?? 0,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

function sameMarkers(
  left: readonly { method: string; enabled: boolean; triggerScore: number }[],
  right: BotBlockerOtpMethodMarkers,
): boolean {
  if (left.length !== right.length) return false;
  const byMethod = new Map(right.map((marker) => [marker.method, marker]));
  return left.every((marker) => {
    const candidate = byMethod.get(marker.method as BotBlockerOtpMethodMarkers[number]["method"]);
    return (
      candidate?.enabled === marker.enabled &&
      candidate.triggerScore === marker.triggerScore
    );
  });
}
