import type { BotBlockerPolicy } from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  BotBlockerPolicyPersistence,
  type PolicyReleaseDocument,
} from "./botblocker-policy-persistence.js";
import { BotBlockerPolicyService } from "./botblocker-policy-service.js";
import type { AuditDocument } from "./persistence.js";
import { createId } from "./security.js";

export class BotBlockerPolicyControlService {
  readonly #audits;

  constructor(
    db: Db,
    private readonly persistence: Pick<
      BotBlockerPolicyPersistence,
      "findReleaseByVersion" | "findSite" | "listReleases"
    >,
    private readonly policies: Pick<BotBlockerPolicyService, "publish">,
  ) {
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async list(siteId: string, limit = 50) {
    const site = await this.persistence.findSite(siteId);
    if (!site) return null;
    const releases = await this.persistence.listReleases(
      {
        customerId: site.customerId,
        projectId: site.projectId,
        siteId: site._id,
      },
      limit,
    );
    return releases.map(toResponse);
  }

  async publish(
    actorId: string,
    policy: BotBlockerPolicy,
    ip?: string,
  ) {
    const site = await this.persistence.findSite(policy.siteId);
    if (site) {
      const existing = await this.persistence.findReleaseByVersion(
        {
          customerId: site.customerId,
          projectId: site.projectId,
          siteId: site._id,
        },
        policy.policyVersion,
      );
      if (
        existing &&
        JSON.stringify(existing.release.policy) === JSON.stringify(policy)
      ) {
        return existing.release;
      }
    }
    const release = await this.policies.publish(policy);
    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId,
      action: "botblocker_policy.published",
      targetType: "botblocker_site",
      targetId: release.policy.siteId,
      occurredAt: new Date(release.issuedAt),
      ip,
      details: {
        policyVersion: release.policy.policyVersion,
        keyId: release.keyId,
      },
    });
    return release;
  }
}

function toResponse(document: PolicyReleaseDocument) {
  return {
    policyReleaseId: document._id,
    siteId: document.siteId,
    policyVersion: document.policyVersion,
    protocolVersion: document.protocolVersion,
    activatesAt: document.activatesAt.toISOString(),
    expiresAt: document.expiresAt.toISOString(),
    issuedAt: document.issuedAt.toISOString(),
    release: document.release,
    createdAt: document.createdAt.toISOString(),
  };
}
