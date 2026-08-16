import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOTBLOCKER_TIMEOUT_DEFAULT_MS } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { BotBlockerSiteService } from "./botblocker-site-service.js";
import type { AuditDocument } from "./persistence.js";
import { ProjectError } from "./project-service.js";

function createFakeDb() {
  const projects = [
    { _id: "prj_1234567890123456", customerId: "usr_owner" },
    { _id: "prj_abcdefghijklmnop", customerId: "usr_other" },
  ];
  const sites = new Map<string, BotBlockerSiteDocument>();
  const audits: AuditDocument[] = [];

  const db = {
    collection(name: string) {
      if (name === "projects") {
        return {
          findOne: async (filter: { _id: string; customerId: string }) =>
            projects.find(
              (project) =>
                project._id === filter._id &&
                project.customerId === filter.customerId,
            ) ?? null,
        };
      }
      if (name === "auditEvents") {
        return {
          insertOne: async (document: AuditDocument) => {
            audits.push(document);
          },
        };
      }
      return {
        findOneAndUpdate: async (
          filter: { _id?: string; projectId: string; customerId: string },
          update: {
            $set?: Partial<BotBlockerSiteDocument>;
            $setOnInsert?: BotBlockerSiteDocument;
          },
        ) => {
          let site = sites.get(filter.projectId);
          if (!site && update.$setOnInsert) {
            site = { ...update.$setOnInsert };
          }
          if (
            !site ||
            site.customerId !== filter.customerId ||
            (filter._id && site._id !== filter._id)
          ) {
            return null;
          }
          site = { ...site, ...update.$set };
          sites.set(filter.projectId, site);
          return site;
        },
        findOne: async (filter: { webhookId: string }) =>
          [...sites.values()].find(
            (site) => site.webhookId === filter.webhookId,
          ) ?? null,
      };
    },
  } as unknown as Db;

  return { db, sites, audits };
}

describe("BotBlockerSiteService", () => {
  it("durably creates a disabled default configuration on first read", async () => {
    const { db, sites } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    const configuration = await service.get(
      "usr_owner",
      "prj_1234567890123456",
    );

    assert.equal(configuration.enabled, false);
    assert.equal(
      configuration.decisionTimeoutMs,
      BOTBLOCKER_TIMEOUT_DEFAULT_MS,
    );
    assert.equal(sites.size, 1);
  });

  it("returns the same durable site on later reads", async () => {
    const { db, sites } = createFakeDb();
    const service = new BotBlockerSiteService(db);
    const first = await service.get("usr_owner", "prj_1234567890123456");
    const second = await service.get("usr_owner", "prj_1234567890123456");

    assert.equal(second.siteId, first.siteId);
    assert.equal(sites.size, 1);
  });

  it("generates a distinct webhookId independent of siteId", async () => {
    const { db } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    const configuration = await service.get(
      "usr_owner",
      "prj_1234567890123456",
    );

    assert.ok(configuration.webhookId);
    assert.notEqual(configuration.webhookId, configuration.siteId);
    assert.match(configuration.webhookId, /^bwh_/);
  });

  it("ensures the site without requiring ownership, for use at project creation", async () => {
    const { db, sites } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    const configuration = await service.ensure(
      "usr_owner",
      "prj_1234567890123456",
    );

    assert.ok(configuration.webhookId);
    assert.equal(sites.size, 1);
  });

  it("resolves a site anonymously by its webhookId, matching only that project", async () => {
    const { db } = createFakeDb();
    const service = new BotBlockerSiteService(db);
    const configuration = await service.get(
      "usr_owner",
      "prj_1234567890123456",
    );

    const resolved = await service.findByWebhookId(configuration.webhookId);
    assert.equal(resolved?.projectId, "prj_1234567890123456");
    assert.equal(resolved?.customerId, "usr_owner");

    assert.equal(await service.findByWebhookId("bwh_does_not_exist"), null);
  });

  it("updates only customer-visible settings and writes an audit event", async () => {
    const { db, sites, audits } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    const updated = await service.update(
      "usr_owner",
      "prj_1234567890123456",
      { enabled: true, decisionTimeoutMs: 50 },
      "192.0.2.1",
    );

    assert.equal(updated.enabled, true);
    assert.equal(updated.decisionTimeoutMs, 50);
    assert.equal(sites.get(updated.projectId)?.enabled, true);
    assert.deepEqual(audits[0]?.details, {
      enabled: true,
      decisionTimeoutMs: 50,
    });
    assert.equal(audits[0]?.ip, "192.0.2.1");
  });

  it("rejects cross-tenant reads without creating configuration", async () => {
    const { db, sites } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    await assert.rejects(
      service.get("usr_other", "prj_1234567890123456"),
      (error: unknown) =>
        error instanceof ProjectError &&
        error.code === "project_not_found" &&
        error.statusCode === 404,
    );
    assert.equal(sites.size, 0);
  });

  it("rejects cross-tenant mutations without an audit event", async () => {
    const { db, audits } = createFakeDb();
    const service = new BotBlockerSiteService(db);

    await assert.rejects(
      service.update("usr_other", "prj_1234567890123456", { enabled: true }),
      ProjectError,
    );
    assert.equal(audits.length, 0);
  });
});
