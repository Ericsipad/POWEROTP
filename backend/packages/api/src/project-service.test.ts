import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
  type HostedAuthDeploymentEnvironment,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { verifyBotBlockerWebhookId } from "./botblocker-webhook.js";
import { ProjectService } from "./project-service.js";
import type {
  ApiKeyDocument,
  AuditDocument,
  ProjectDocument,
} from "./persistence.js";
import { decryptString } from "./security.js";

const endpointSecret = "c".repeat(32);
const config = {
  API_KEY_HASH_SECRET: "a".repeat(32),
  CONFIG_ENCRYPTION_KEY: "b".repeat(32),
  BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: endpointSecret,
  PUBLIC_API_URL: "https://api.powerotp.com",
};

function fixture(
  failCollection?: string,
  hostedAuthEnvironment: HostedAuthDeploymentEnvironment = "test",
) {
  const projects = new Map<string, ProjectDocument>();
  const apiKeys = new Map<string, ApiKeyDocument>();
  const sites = new Map<string, BotBlockerSiteDocument>();
  const audits: AuditDocument[] = [];

  const db = {
    collection(name: string) {
      const map = name === "projects"
        ? projects
        : name === "apiKeys"
        ? apiKeys
        : name === "botblockerSites"
        ? sites
        : undefined;
      if (map) {
        return {
          insertOne: async (document: { _id: string }) => {
            if (name === failCollection) throw new Error(`${name} failed`);
            (map as Map<string, { _id: string }>).set(document._id, document);
          },
          findOne: async (filter: Record<string, unknown>) =>
            [...map.values()].find((document) =>
              Object.entries(filter).every(
                ([key, value]) =>
                  key === "revokedAt" ||
                  (document as unknown as Record<string, unknown>)[key] === value,
              ),
            ),
          findOneAndUpdate: async (
            filter: Record<string, unknown>,
            update: { $set: Partial<ProjectDocument> },
          ) => {
            const document = [...projects.values()].find((candidate) =>
              Object.entries(filter).every(
                ([key, value]) =>
                  (candidate as unknown as Record<string, unknown>)[key] === value,
              ),
            );
            if (!document) return null;
            Object.assign(document, update.$set);
            return document;
          },
          updateOne: async (
            filter: Record<string, unknown>,
            update: {
              $set: Partial<ProjectDocument>;
              $setOnInsert?: Partial<ProjectDocument>;
            },
            options?: { upsert?: boolean },
          ) => {
            const document = [...projects.values()].find((candidate) =>
              Object.entries(filter).every(
                ([key, value]) =>
                  (candidate as unknown as Record<string, unknown>)[key] === value,
              ),
            );
            if (document) {
              Object.assign(document, update.$set);
              return;
            }
            if (options?.upsert && update.$setOnInsert?._id) {
              projects.set(update.$setOnInsert._id, {
                ...update.$setOnInsert,
                ...update.$set,
              } as ProjectDocument);
            }
          },
        };
      }
      return {
        insertOne: async (document: AuditDocument) => {
          audits.push(document);
        },
        insertMany: async (documents: AuditDocument[]) => {
          if (name === failCollection) throw new Error(`${name} failed`);
          audits.push(...documents);
        },
      };
    },
  } as unknown as Db;

  const client = {
    withSession: async (
      work: (session: {
        withTransaction(transaction: () => Promise<void>): Promise<void>;
      }) => Promise<void>,
    ) => {
      const snapshot = {
        projects: new Map(projects),
        apiKeys: new Map(apiKeys),
        sites: new Map(sites),
        audits: [...audits],
      };
      await work({
        async withTransaction(transaction) {
          try {
            await transaction();
          } catch (error) {
            restore(projects, snapshot.projects);
            restore(apiKeys, snapshot.apiKeys);
            restore(sites, snapshot.sites);
            audits.splice(0, audits.length, ...snapshot.audits);
            throw error;
          }
        },
      });
    },
  } as unknown as MongoClient;

  return {
    service: new ProjectService(
      db,
      client,
      config as never,
      hostedAuthEnvironment,
    ),
    db,
    client,
    projects,
    apiKeys,
    sites,
    audits,
  };
}

const validInput = {
  name: "Test project",
  identityDataMode: "powerotp_pii" as const,
  enabledMethods: [] as never[],
  allowedOrigins: ["https://example.test"],
};

describe("ProjectService atomic BotBlocker provisioning", () => {
  it("creates the project, API key, site, endpoint, secret, and audits together", async () => {
    const { service, projects, apiKeys, sites, audits } = fixture();
    const created = await service.create("usr_owner", validInput);

    assert.equal(projects.size, 1);
    assert.equal(apiKeys.size, 1);
    assert.equal(sites.size, 1);
    assert.equal(audits.length, 3);
    assert.equal(created.botBlocker.siteId, [...sites.keys()][0]);
    assert.deepEqual(
      verifyBotBlockerWebhookId(created.botBlocker.webhookId, endpointSecret),
      {
        version: 1,
        endpointId: verifyBotBlockerWebhookId(
          created.botBlocker.webhookId,
          endpointSecret,
        )?.endpointId,
        projectId: created.project.id,
        siteId: created.botBlocker.siteId,
      },
    );
    const site = [...sites.values()][0]!;
    assert.deepEqual(
      site.otpMethodMarkers,
      DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
    );
    assert.equal(site.otpPolicyVersion, 0);
    assert.notEqual(
      site.webhookSigningSecretEncrypted,
      created.botBlocker.webhookSigningSecret,
    );
    assert.equal(
      decryptString(
        site.webhookSigningSecretEncrypted,
        config.CONFIG_ENCRYPTION_KEY,
      ),
      created.botBlocker.webhookSigningSecret,
    );
  });

  for (const failed of ["apiKeys", "botblockerSites", "auditEvents"]) {
    it(`aborts every write when ${failed} insertion fails`, async () => {
      const { service, projects, apiKeys, sites, audits } = fixture(failed);
      await assert.rejects(service.create("usr_owner", validInput));
      assert.equal(projects.size, 0);
      assert.equal(apiKeys.size, 0);
      assert.equal(sites.size, 0);
      assert.equal(audits.length, 0);
    });
  }

  it("fails before opening a transaction when endpoint signing is unavailable", async () => {
    const { db, client, projects, apiKeys, sites } = fixture();
    const unavailable = new ProjectService(
      db,
      client,
      { ...config, BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: undefined } as never,
      "test",
    );
    await assert.rejects(unavailable.create("usr_owner", validInput));
    assert.equal(projects.size, 0);
    assert.equal(apiKeys.size, 0);
    assert.equal(sites.size, 0);
  });
});

describe("ProjectService hosted-auth project configuration", () => {
  it("mints unique immutable identifiers and exact mode-scoped hosted URLs", async () => {
    const { service, projects } = fixture(undefined, "production");
    const powerOtp = await service.create("usr_owner", validInput);
    const didit = await service.create("usr_owner", {
      ...validInput,
      name: "Didit project",
      identityDataMode: "didit_pii",
    });

    assert.match(powerOtp.project.identifierString, /^pai_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(
      powerOtp.project.identifierString,
      didit.project.identifierString,
    );
    assert.equal(powerOtp.project.authRealm, "https://authx.powerotp.com");
    assert.equal(powerOtp.project.rpId, "authx.powerotp.com");
    assert.equal(didit.project.authRealm, "https://authz.powerotp.com");
    assert.equal(didit.project.rpId, "authz.powerotp.com");
    assert.equal(
      powerOtp.project.signupHostedUrl,
      `${powerOtp.project.authRealm}/signup/${powerOtp.project.slug}/${powerOtp.project.identifierString}`,
    );
    assert.equal(
      didit.project.signinHostedUrl,
      `${didit.project.authRealm}/signin/${didit.project.slug}/${didit.project.identifierString}`,
    );
    assert.equal(
      new Set([...projects.values()].map((project) => project.identifierString))
        .size,
      2,
    );
  });

  it("keeps hosted-auth configuration unchanged on updates and enforces ownership", async () => {
    const { service, projects } = fixture();
    const created = await service.create("usr_owner", validInput);
    const before = { ...projects.get(created.project.id)! };

    const updated = await service.update(
      "usr_owner",
      created.project.id,
      { name: "Renamed project" },
    );
    assert.equal(updated.name, "Renamed project");
    for (const field of [
      "identityDataMode",
      "identifierString",
      "authRealm",
      "rpId",
      "signupHostedUrl",
      "signinHostedUrl",
    ] as const) {
      assert.equal(projects.get(created.project.id)![field], before[field]);
    }
    await assert.rejects(
      service.update("usr_other", created.project.id, { name: "Stolen" }),
      (error: unknown) =>
        error instanceof Error && error.message === "project_not_found",
    );
  });

  it("leaves the internal landing-page demo outside hosted auth", async () => {
    const { service, projects } = fixture(undefined, "production");
    const first = await service.ensureDemoProject(
      "demo",
      "https://powerotp.com",
      "usr_platform_admin",
    );
    const original = [...projects.values()][0]!;

    assert.deepEqual(first, { slug: "demo" });
    assert.equal(original.identityDataMode, undefined);
    assert.equal(original.identifierString, undefined);
    assert.equal(original.authRealm, undefined);
    assert.equal(original.rpId, undefined);
    assert.equal(original.signupHostedUrl, undefined);
    assert.equal(original.signinHostedUrl, undefined);

    await service.ensureDemoProject(
      "demo",
      "https://powerotp.com",
      "usr_platform_admin",
    );
    assert.equal([...projects.values()][0]!._id, original._id);
  });
});

function restore<T>(target: Map<string, T>, source: Map<string, T>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
