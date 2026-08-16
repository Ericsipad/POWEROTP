import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { ProjectService } from "./project-service.js";
import type { ApiKeyDocument, AuditDocument, ProjectDocument } from "./persistence.js";

const config = {
  API_KEY_HASH_SECRET: "a".repeat(32),
  CONFIG_ENCRYPTION_KEY: "b".repeat(32),
  PUBLIC_API_URL: "https://api.powerotp.com",
} as never;

function createFakeDb() {
  const projects = new Map<string, ProjectDocument>();
  const apiKeys = new Map<string, ApiKeyDocument>();
  const audits: AuditDocument[] = [];

  const db = {
    collection(name: string) {
      if (name === "projects") {
        return {
          insertOne: async (document: ProjectDocument) => {
            projects.set(document._id, document);
          },
          deleteOne: async (filter: { _id: string }) => {
            projects.delete(filter._id);
          },
        };
      }
      if (name === "apiKeys") {
        return {
          insertOne: async (document: ApiKeyDocument) => {
            apiKeys.set(document._id, document);
          },
          deleteOne: async (filter: { _id: string }) => {
            apiKeys.delete(filter._id);
          },
          findOne: async () => undefined,
        };
      }
      return {
        insertOne: async (document: AuditDocument) => {
          audits.push(document);
        },
      };
    },
  } as unknown as Db;

  return { db, projects, apiKeys, audits };
}

const validInput = {
  name: "Test project",
  enabledMethods: [] as never[],
  allowedOrigins: ["https://example.test"],
};

describe("ProjectService", () => {
  it("provisions the BotBlocker site/webhook the moment a project is created", async () => {
    const { db } = createFakeDb();
    const ensured: Array<{ customerId: string; projectId: string }> = [];
    const service = new ProjectService(db, config, undefined, async (customerId, projectId) => {
      ensured.push({ customerId, projectId });
    });

    const { project } = await service.create("usr_owner", validInput);

    assert.equal(ensured.length, 1);
    assert.equal(ensured[0]?.customerId, "usr_owner");
    assert.equal(ensured[0]?.projectId, project.id);
  });

  it("rolls back the project and API key if BotBlocker site provisioning fails", async () => {
    const { db, projects, apiKeys } = createFakeDb();
    const service = new ProjectService(db, config, undefined, async () => {
      throw new Error("provisioning failed");
    });

    await assert.rejects(service.create("usr_owner", validInput));

    assert.equal(projects.size, 0);
    assert.equal(apiKeys.size, 0);
  });

  it("creates a project normally when no BotBlocker provisioning hook is supplied", async () => {
    const { db, projects, apiKeys } = createFakeDb();
    const service = new ProjectService(db, config);

    const { project } = await service.create("usr_owner", validInput);

    assert.equal(projects.size, 1);
    assert.equal(apiKeys.size, 1);
    assert.equal(project.name, "Test project");
  });
});
