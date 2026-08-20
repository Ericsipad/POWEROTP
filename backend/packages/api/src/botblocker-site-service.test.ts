import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";
import { DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS } from "@powerotp/contracts";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { BotBlockerSiteService } from "./botblocker-site-service.js";
import type { AuditDocument } from "./persistence.js";
import { ProjectError } from "./project-service.js";

const project = {
  _id: "prj_1234567890123456",
  customerId: "usr_owner",
  active: true,
  allowedOrigins: ["https://customer.example"],
};
const site: BotBlockerSiteDocument = {
  _id: "bbs_1234567890123456",
  projectId: project._id,
  customerId: project.customerId,
  webhookId: `bwh_${"A".repeat(120)}.${"B".repeat(43)}`,
  webhookSigningSecretEncrypted: "encrypted.secret.value",
  enabled: false,
  decisionTimeoutMs: 200,
  createdAt: new Date("2026-08-16T00:00:00.000Z"),
  updatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

function fixture(includeSite = true) {
  const sites = new Map<string, BotBlockerSiteDocument>(
    includeSite ? [[site.projectId, { ...site }]] : [],
  );
  const audits: AuditDocument[] = [];
  const db = {
    collection(name: string) {
      if (name === "projects") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            filter._id === project._id &&
              (!filter.customerId || filter.customerId === project.customerId)
              ? project
              : null,
        };
      }
      if (name === "auditEvents") {
        return {
          insertOne: async (document: AuditDocument) => audits.push(document),
        };
      }
      return {
        findOne: async (filter: Record<string, unknown>) =>
          [...sites.values()].find((candidate) =>
            (!filter._id || candidate._id === filter._id) &&
            (!filter.projectId || candidate.projectId === filter.projectId) &&
            (!filter.customerId || candidate.customerId === filter.customerId) &&
            (!filter.webhookId || candidate.webhookId === filter.webhookId)
          ) ?? null,
        findOneAndUpdate: async (
          filter: { _id: string; projectId: string; customerId: string },
          update: {
            $set: Partial<BotBlockerSiteDocument>;
            $inc?: { otpPolicyVersion: number };
          },
        ) => {
          const current = sites.get(filter.projectId);
          if (
            !current ||
            current._id !== filter._id ||
            current.customerId !== filter.customerId
          ) {
            return null;
          }
          const updated = {
            ...current,
            ...update.$set,
            ...(update.$inc
              ? {
                  otpPolicyVersion:
                    (current.otpPolicyVersion ?? 0) +
                    update.$inc.otpPolicyVersion,
                }
              : {}),
          };
          sites.set(filter.projectId, updated);
          return updated;
        },
      };
    },
  } as unknown as Db;
  return { service: new BotBlockerSiteService(db), sites, audits };
}

describe("BotBlockerSiteService", () => {
  it("reads only the site provisioned atomically with the project", async () => {
    const { service } = fixture();
    const configuration = await service.get(project.customerId, project._id);
    assert.equal(configuration.siteId, site._id);
    assert.equal(configuration.webhookId, site.webhookId);
    assert.deepEqual(
      configuration.otpMethodMarkers,
      DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
    );
    assert.equal(configuration.otpPolicyVersion, 0);
  });

  it("never lazily creates a missing site", async () => {
    const { service, sites } = fixture(false);
    await assert.rejects(
      service.get(project.customerId, project._id),
      (error: unknown) =>
        error instanceof ProjectError &&
        error.code === "botblocker_site_not_found",
    );
    assert.equal(sites.size, 0);
  });

  it("resolves only an exact signed-token project/site/endpoint scope", async () => {
    const { service } = fixture();
    const resolved = await service.resolveRuntimeSite({
      projectId: project._id,
      siteId: site._id,
      webhookId: site.webhookId,
    });
    assert.deepEqual(resolved, {
      customerId: project.customerId,
      projectId: project._id,
      siteId: site._id,
      webhookId: site.webhookId,
      enabled: false,
      projectActive: true,
      allowedOrigins: project.allowedOrigins,
    });
    assert.equal(
      await service.resolveRuntimeSite({
        projectId: "prj_other_1234567890",
        siteId: site._id,
        webhookId: site.webhookId,
      }),
      undefined,
    );
  });

  it("updates only mutable customer settings and leaves endpoint immutable", async () => {
    const { service, sites, audits } = fixture();
    const updated = await service.update(
      project.customerId,
      project._id,
      { enabled: true, decisionTimeoutMs: 50 },
      "192.0.2.1",
    );
    assert.equal(updated.webhookId, site.webhookId);
    assert.equal(sites.get(project._id)?.enabled, true);
    assert.deepEqual(audits[0]?.details, {
      enabled: true,
      decisionTimeoutMs: 50,
    });
  });

  it("rejects cross-tenant reads and mutations", async () => {
    const { service, audits } = fixture();
    await assert.rejects(
      service.get("usr_other", project._id),
      ProjectError,
    );
    await assert.rejects(
      service.update("usr_other", project._id, { enabled: true }),
      ProjectError,
    );
    assert.equal(audits.length, 0);
  });

  it("always saves valid marker settings without runtime readiness checks", async () => {
    const { service, sites, audits } = fixture();
    const otpMethodMarkers = DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.map(
      (marker) => ({
        ...marker,
        enabled: marker.method === "voice_code",
        triggerScore: marker.method === "voice_code" ? 55 : marker.triggerScore,
      }),
    );

    const updated = await service.update(
      project.customerId,
      project._id,
      { otpMethodMarkers },
      "192.0.2.1",
    );

    assert.deepEqual(updated.otpMethodMarkers, otpMethodMarkers);
    assert.equal(updated.otpPolicyVersion, 1);
    assert.deepEqual(sites.get(project._id)?.otpMethodMarkers, otpMethodMarkers);
    assert.equal(audits[1]?.action, "botblocker_otp_policy.updated");
    assert.deepEqual(audits[1]?.details, {
      previousVersion: 0,
      newVersion: 1,
      previousMarkers: JSON.stringify(DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS),
      newMarkers: JSON.stringify(otpMethodMarkers),
    });
  });

  it("treats an identical marker retry as a no-op", async () => {
    const configuredSite = {
      ...site,
      otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.map((marker) => ({
        ...marker,
        enabled: marker.method === "voice_code",
      })),
      otpPolicyVersion: 1,
    };
    const { service, audits } = fixture();

    const first = await service.update(project.customerId, project._id, {
      otpMethodMarkers: configuredSite.otpMethodMarkers,
    });
    const second = await service.update(project.customerId, project._id, {
      otpMethodMarkers: configuredSite.otpMethodMarkers,
    });

    assert.equal(first.otpPolicyVersion, 1);
    assert.equal(second.otpPolicyVersion, 1);
    assert.equal(audits.length, 2);
  });
});
