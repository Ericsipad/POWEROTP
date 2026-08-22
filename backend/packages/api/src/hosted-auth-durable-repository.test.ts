import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Collection, Db } from "mongodb";

import {
  AUTH_PAGE_TEMPLATES_COLLECTION_NAME,
  AUTH_SECURITY_EVENTS_COLLECTION_NAME,
  ensureHostedAuthDurableIndexes,
  ensureHostedAuthTemplateIndexes,
  HostedAuthSecurityEventRepository,
  PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME,
  ProjectIdentityBindingRepository,
  WRAPPED_IDENTITY_KEYS_COLLECTION_NAME,
} from "./hosted-auth-durable-repository.js";
import {
  HostedAuthPageTemplateRecordSchema,
  HostedAuthSecurityEventRecordSchema,
  ProjectIdentityBindingRecordSchema,
  WrappedIdentityKeyRecordSchema,
  type HostedAuthSecurityEventDocument,
  type HostedAuthSecurityEventRecord,
  type ProjectIdentityBindingDocument,
  type ProjectIdentityBindingRecord,
} from "./hosted-auth-durable-schemas.js";

const body = "A".repeat(43);
const otherBody = `${"B".repeat(42)}A`;
const createdAt = new Date("2026-08-22T01:30:00.000Z");
const retentionExpiresAt = new Date("2027-08-22T01:30:00.000Z");
const binding = {
  bindingId: `pib_${body}`,
  projectId: "project_12345678",
  hostedPersonIdentityId: `hpi_${body}`,
  projectUserId: `pusr_${body}`,
  status: "active",
  derivationVersion: 1,
  createdAt,
} as const satisfies ProjectIdentityBindingRecord;
const emptyRichText = { schemaVersion: 1, blocks: [] } as const;
const row = { enabled: true, richText: emptyRichText };
const template = {
  projectId: binding.projectId,
  pageType: "signup",
  templateType: "template_1",
  rows: { A: row, B: row, C: row, D: row, E: row, F: row },
  adPositionsEnabled: [true, false, true, false, true, false],
  revision: 0,
  updatedAt: createdAt,
  updatedBy: "operator:operator_123456",
} as const;
const securityEvent = {
  eventId: `hse_${body}`,
  projectId: binding.projectId,
  eventType: "project_auth_configuration_changed",
  actorType: "project_admin",
  actorReference: "project_admin:admin_12345678",
  targetType: "project_configuration",
  targetReference: "project:project_12345678",
  changedFields: ["return_urls", "template"],
  outcome: "succeeded",
  correlationId: "correlation_123456",
  occurredAt: createdAt,
  retentionExpiresAt,
} as const satisfies HostedAuthSecurityEventRecord;

class MemoryBindingCollection {
  readonly documents = new Map<string, ProjectIdentityBindingDocument>();

  async updateOne(
    filter: { _id: string },
    update: { $setOnInsert: ProjectIdentityBindingDocument },
  ) {
    if (this.documents.has(filter._id)) {
      return { acknowledged: true, upsertedCount: 0 };
    }
    this.documents.set(filter._id, structuredClone(update.$setOnInsert));
    return { acknowledged: true, upsertedCount: 1 };
  }

  async findOne(filter: { _id: string }) {
    const document = this.documents.get(filter._id);
    return document ? structuredClone(document) : null;
  }
}

class MemorySecurityEventCollection {
  readonly documents = new Map<string, HostedAuthSecurityEventDocument>();

  async insertOne(document: HostedAuthSecurityEventDocument) {
    if (this.documents.has(document._id)) {
      throw new Error("duplicate security event");
    }
    this.documents.set(document._id, structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }
}

describe("hosted-auth durable schemas and repositories", () => {
  it("creates uniqueness and retention indexes in the intended stores", async () => {
    const durableIndexes: Array<{
      collection: string;
      keys: object;
      options: object;
    }> = [];
    const templateIndexes: typeof durableIndexes = [];
    const database = (indexes: typeof durableIndexes) =>
      ({
        collection(collection: string) {
          return {
            async createIndex(keys: object, options: object) {
              indexes.push({ collection, keys, options });
              return String(options);
            },
          };
        },
      }) as unknown as Db;

    await ensureHostedAuthDurableIndexes(database(durableIndexes));
    await ensureHostedAuthTemplateIndexes(database(templateIndexes));

    assert.deepEqual(durableIndexes, [
      {
        collection: PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME,
        keys: { projectId: 1, hostedPersonIdentityId: 1 },
        options: { unique: true, name: "project_person_unique" },
      },
      {
        collection: PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME,
        keys: { projectId: 1, projectUserId: 1 },
        options: { unique: true, name: "project_user_unique" },
      },
      {
        collection: WRAPPED_IDENTITY_KEYS_COLLECTION_NAME,
        keys: { hostedPersonIdentityId: 1 },
        options: { unique: true, name: "person_key_unique" },
      },
      {
        collection: AUTH_SECURITY_EVENTS_COLLECTION_NAME,
        keys: { projectId: 1, occurredAt: -1 },
        options: { name: "project_occurred" },
      },
      {
        collection: AUTH_SECURITY_EVENTS_COLLECTION_NAME,
        keys: { retentionExpiresAt: 1 },
        options: {
          expireAfterSeconds: 0,
          name: "retentionExpiresAt_ttl",
        },
      },
    ]);
    assert.deepEqual(templateIndexes, [
      {
        collection: AUTH_PAGE_TEMPLATES_COLLECTION_NAME,
        keys: { projectId: 1, pageType: 1, templateType: 1 },
        options: { unique: true, name: "project_page_template_unique" },
      },
    ]);
  });

  it("keeps bindings immutable across duplicate and conflicting creation", async () => {
    const collection = new MemoryBindingCollection();
    const repository = new ProjectIdentityBindingRepository(
      {} as Db,
      collection as unknown as Collection<ProjectIdentityBindingDocument>,
    );

    assert.equal(await repository.create(binding), "inserted");
    assert.equal(await repository.create(binding), "duplicate");
    await assert.rejects(
      repository.create({
        ...binding,
        projectUserId: `pusr_${otherBody}`,
      }),
      /Conflicting hosted-auth project binding/,
    );
    assert.equal(collection.documents.size, 1);
    assert.equal(
      collection.documents.get(binding.bindingId)?.projectUserId,
      binding.projectUserId,
    );
  });

  it("accepts only strict binding and wrapped-key metadata", () => {
    assert.equal(ProjectIdentityBindingRecordSchema.parse(binding).status, "active");
    assert.equal(
      WrappedIdentityKeyRecordSchema.parse({
        hostedPersonIdentityId: binding.hostedPersonIdentityId,
        kmsKeyVersion: "kek_v1",
        wrappedDekCiphertext: body,
        status: "active",
        createdAt,
      }).status,
      "active",
    );
    assert.throws(() =>
      ProjectIdentityBindingRecordSchema.parse({
        ...binding,
        email: "person@example.test",
      }),
    );
    assert.throws(() =>
      WrappedIdentityKeyRecordSchema.parse({
        hostedPersonIdentityId: binding.hostedPersonIdentityId,
        kmsKeyVersion: "kek_v1",
        plaintextDek: "secret",
        status: "active",
        createdAt,
      }),
    );
    assert.throws(() =>
      WrappedIdentityKeyRecordSchema.parse({
        hostedPersonIdentityId: binding.hostedPersonIdentityId,
        kmsKeyVersion: "kek_v1",
        wrappedDekCiphertext: body,
        status: "crypto_shredded",
        createdAt,
        cryptoShreddedAt: createdAt,
      }),
    );
  });

  it("isolates page, row, image, and ad configuration with no executable content", () => {
    const parsed = HostedAuthPageTemplateRecordSchema.parse(template);
    assert.equal(parsed.pageType, "signup");
    assert.equal(parsed.rows.A.richText.blocks.length, 0);
    assert.equal(parsed.adPositionsEnabled.length, 6);

    assert.throws(() =>
      HostedAuthPageTemplateRecordSchema.parse({
        ...template,
        rows: {
          ...template.rows,
          A: {
            ...row,
            rawHtml: "<script>alert(1)</script>",
            remoteImageUrl: "https://attacker.example/image.svg",
          },
        },
      }),
    );
    assert.throws(() =>
      HostedAuthPageTemplateRecordSchema.parse({
        ...template,
        adPositionsEnabled: [true],
      }),
    );
    assert.throws(() =>
      HostedAuthPageTemplateRecordSchema.parse({
        ...template,
        pageType: "signin",
        projectId: "other_project",
      }),
    );
  });

  it("appends redacted non-request security events without overwrite", async () => {
    const collection = new MemorySecurityEventCollection();
    const repository = new HostedAuthSecurityEventRepository(
      {} as Db,
      collection as unknown as Collection<HostedAuthSecurityEventDocument>,
    );

    await repository.append(securityEvent);
    await assert.rejects(
      repository.append({ ...securityEvent, outcome: "failed" }),
      /duplicate security event/,
    );
    assert.deepEqual(collection.documents.get(securityEvent.eventId), {
      _id: securityEvent.eventId,
      projectId: securityEvent.projectId,
      eventType: securityEvent.eventType,
      actorType: securityEvent.actorType,
      actorReference: securityEvent.actorReference,
      targetType: securityEvent.targetType,
      targetReference: securityEvent.targetReference,
      changedFields: securityEvent.changedFields,
      outcome: securityEvent.outcome,
      correlationId: securityEvent.correlationId,
      occurredAt: securityEvent.occurredAt,
      retentionExpiresAt: securityEvent.retentionExpiresAt,
    });
    assert.throws(() =>
      HostedAuthSecurityEventRecordSchema.parse({
        ...securityEvent,
        authRequestId: `har_${body}`,
        pollTokenHash: "secret",
        browserHandle: "secret",
        email: "person@example.test",
        providerPayload: { token: "secret" },
      }),
    );
    assert.throws(() =>
      HostedAuthSecurityEventRecordSchema.parse({
        ...securityEvent,
        retentionExpiresAt: createdAt,
      }),
    );
  });
});
