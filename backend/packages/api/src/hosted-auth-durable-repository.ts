import type { Collection, Db } from "mongodb";
import { HostedPersonIdentityIdSchema } from "@powerotp/contracts";

import {
  HostedAuthSecurityEventRecordSchema,
  ProjectIdentityBindingRecordSchema,
  WrappedIdentityKeyRecordSchema,
  type HostedAuthSecurityEventDocument,
  type HostedAuthSecurityEventRecord,
  type ProjectIdentityBindingDocument,
  type ProjectIdentityBindingRecord,
  type WrappedIdentityKeyDocument,
  type WrappedIdentityKeyRecord,
} from "./hosted-auth-durable-schemas.js";

export const PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME =
  "projectIdentityBindings";
export const WRAPPED_IDENTITY_KEYS_COLLECTION_NAME = "wrappedIdentityKeys";
export const AUTH_PAGE_TEMPLATES_COLLECTION_NAME = "authPageTemplates";
export const AUTH_SECURITY_EVENTS_COLLECTION_NAME = "authSecurityEvents";

type BindingCollection = Pick<
  Collection<ProjectIdentityBindingDocument>,
  "findOne" | "updateMany" | "updateOne"
>;

export class ProjectIdentityBindingRepository {
  private readonly bindings: BindingCollection;

  constructor(db: Db, collection?: BindingCollection) {
    this.bindings =
      collection ??
      db.collection<ProjectIdentityBindingDocument>(
        PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME,
      );
  }

  async create(
    input: ProjectIdentityBindingRecord,
  ): Promise<"inserted" | "duplicate"> {
    const record = ProjectIdentityBindingRecordSchema.parse(input);
    const { bindingId, ...fields } = record;
    const document = { _id: bindingId, ...fields };
    const result = await this.bindings.updateOne(
      { _id: bindingId },
      { $setOnInsert: document },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return "inserted";

    const existing = await this.bindings.findOne({ _id: bindingId });
    if (existing && JSON.stringify(existing) === JSON.stringify(document)) {
      return "duplicate";
    }
    throw new Error("Conflicting hosted-auth project binding");
  }

  async findByProjectPerson(
    projectId: string,
    hostedPersonIdentityId: ProjectIdentityBindingRecord["hostedPersonIdentityId"],
  ): Promise<ProjectIdentityBindingRecord | null> {
    const document = await this.bindings.findOne({
      projectId,
      hostedPersonIdentityId,
    });
    if (!document) return null;
    const { _id, ...record } = document;
    return ProjectIdentityBindingRecordSchema.parse({
      bindingId: _id,
      ...record,
    });
  }

  async hasForPerson(hostedPersonIdentityId: string): Promise<boolean> {
    const document = await this.bindings.findOne({
      hostedPersonIdentityId: HostedPersonIdentityIdSchema.parse(
        hostedPersonIdentityId,
      ),
    });
    return document !== null;
  }

  async markDeletedForPerson(hostedPersonIdentityId: string): Promise<void> {
    await this.bindings.updateMany(
      {
        hostedPersonIdentityId: HostedPersonIdentityIdSchema.parse(
          hostedPersonIdentityId,
        ),
        status: { $ne: "deleted" },
      },
      { $set: { status: "deleted" } },
    );
  }

  async createOrGet(
    input: ProjectIdentityBindingRecord,
  ): Promise<ProjectIdentityBindingRecord> {
    const record = ProjectIdentityBindingRecordSchema.parse(input);
    const { bindingId, ...fields } = record;
    await this.bindings.updateOne(
      {
        projectId: record.projectId,
        hostedPersonIdentityId: record.hostedPersonIdentityId,
      },
      { $setOnInsert: { _id: bindingId, ...fields } },
      { upsert: true },
    );
    const persisted = await this.findByProjectPerson(
      record.projectId,
      record.hostedPersonIdentityId,
    );
    if (!persisted) {
      throw new Error("Hosted-auth project binding is unavailable");
    }
    return persisted;
  }
}

type WrappedKeyCollection = Pick<
  Collection<WrappedIdentityKeyDocument>,
  "deleteOne" | "find" | "findOne" | "updateOne"
>;

export class WrappedIdentityKeyRepository {
  private readonly keys: WrappedKeyCollection;

  constructor(db: Db, collection?: WrappedKeyCollection) {
    this.keys =
      collection ??
      db.collection<WrappedIdentityKeyDocument>(
        WRAPPED_IDENTITY_KEYS_COLLECTION_NAME,
      );
  }

  async findActive(
    hostedPersonIdentityId: string,
  ): Promise<WrappedIdentityKeyRecord | null> {
    const document = await this.keys.findOne({
      _id: hostedPersonIdentityId,
      status: "active",
    });
    if (!document) return null;
    const { _id, ...record } = document;
    if (_id !== record.hostedPersonIdentityId) {
      throw new Error("Hosted-auth wrapped-key identity mismatch");
    }
    return WrappedIdentityKeyRecordSchema.parse(record);
  }

  async createActive(
    input: WrappedIdentityKeyRecord,
  ): Promise<Readonly<{ outcome: "inserted" | "existing"; record: WrappedIdentityKeyRecord }>> {
    const record = WrappedIdentityKeyRecordSchema.parse(input);
    if (record.status !== "active") {
      throw new Error("Only active hosted-auth wrapped keys can be created");
    }
    const document = { _id: record.hostedPersonIdentityId, ...record };
    const result = await this.keys.updateOne(
      { _id: document._id },
      { $setOnInsert: document },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      return { outcome: "inserted", record };
    }
    const existing = await this.findActive(record.hostedPersonIdentityId);
    if (!existing) {
      throw new Error("Hosted-auth identity key is unavailable");
    }
    return { outcome: "existing", record: existing };
  }

  async deleteActive(hostedPersonIdentityId: string): Promise<boolean> {
    const result = await this.keys.deleteOne({
      _id: HostedPersonIdentityIdSchema.parse(hostedPersonIdentityId),
      status: "active",
    });
    return result.deletedCount === 1;
  }

  async cryptoShred(
    hostedPersonIdentityId: string,
    cryptoShreddedAt: Date,
  ): Promise<"shredded" | "duplicate" | "absent"> {
    const identityId = HostedPersonIdentityIdSchema.parse(
      hostedPersonIdentityId,
    );
    if (Number.isNaN(cryptoShreddedAt.getTime())) {
      throw new Error("A valid hosted-auth crypto-shredding timestamp is required");
    }
    const result = await this.keys.updateOne(
      { _id: identityId, status: "active" },
      {
        $set: { status: "crypto_shredded", cryptoShreddedAt },
        $unset: { wrappedDekCiphertext: "" },
      },
    );
    if (result.modifiedCount === 1) return "shredded";

    const existing = await this.keys.findOne({ _id: identityId });
    if (!existing) return "absent";
    const { _id, ...record } = existing;
    if (_id !== record.hostedPersonIdentityId) {
      throw new Error("Hosted-auth wrapped-key identity mismatch");
    }
    const parsed = WrappedIdentityKeyRecordSchema.parse(record);
    if (parsed.status === "crypto_shredded") return "duplicate";
    throw new Error("Hosted-auth wrapped key could not be crypto-shredded");
  }

  async listActiveBefore(
    before: Date,
    limit: number,
    after?: Readonly<{ createdAt: Date; hostedPersonIdentityId: string }>,
  ): Promise<WrappedIdentityKeyRecord[]> {
    if (Number.isNaN(before.getTime())) {
      throw new Error("A valid hosted-auth wrapped-key cutoff is required");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Hosted-auth wrapped-key scan limit must be 1-1000");
    }
    const afterFilter = after
      ? {
          $or: [
            { createdAt: { $gt: after.createdAt } },
            {
              createdAt: after.createdAt,
              _id: {
                $gt: HostedPersonIdentityIdSchema.parse(
                  after.hostedPersonIdentityId,
                ),
              },
            },
          ],
        }
      : {};
    const documents = await this.keys
      .find({
        status: "active",
        createdAt: { $lt: before },
        ...afterFilter,
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map(({ _id, ...record }) => {
      if (_id !== record.hostedPersonIdentityId) {
        throw new Error("Hosted-auth wrapped-key identity mismatch");
      }
      return WrappedIdentityKeyRecordSchema.parse(record);
    });
  }
}

type SecurityEventCollection = Pick<
  Collection<HostedAuthSecurityEventDocument>,
  "insertOne"
>;

export class HostedAuthSecurityEventRepository {
  private readonly events: SecurityEventCollection;

  constructor(db: Db, collection?: SecurityEventCollection) {
    this.events =
      collection ??
      db.collection<HostedAuthSecurityEventDocument>(
        AUTH_SECURITY_EVENTS_COLLECTION_NAME,
      );
  }

  async append(input: HostedAuthSecurityEventRecord): Promise<void> {
    const event = HostedAuthSecurityEventRecordSchema.parse(input);
    const { eventId, ...fields } = event;
    await this.events.insertOne({ _id: eventId, ...fields });
  }
}

export async function ensureHostedAuthDurableIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME).createIndex(
      { projectId: 1, hostedPersonIdentityId: 1 },
      { unique: true, name: "project_person_unique" },
    ),
    db.collection(PROJECT_IDENTITY_BINDINGS_COLLECTION_NAME).createIndex(
      { projectId: 1, projectUserId: 1 },
      { unique: true, name: "project_user_unique" },
    ),
    db.collection(WRAPPED_IDENTITY_KEYS_COLLECTION_NAME).createIndex(
      { hostedPersonIdentityId: 1 },
      { unique: true, name: "person_key_unique" },
    ),
    db.collection(AUTH_SECURITY_EVENTS_COLLECTION_NAME).createIndex(
      { projectId: 1, occurredAt: -1 },
      { name: "project_occurred" },
    ),
    db.collection(AUTH_SECURITY_EVENTS_COLLECTION_NAME).createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0, name: "retentionExpiresAt_ttl" },
    ),
  ]);
}

export async function ensureHostedAuthTemplateIndexes(db: Db): Promise<void> {
  await db.collection(AUTH_PAGE_TEMPLATES_COLLECTION_NAME).createIndex(
    { projectId: 1, pageType: 1, templateType: 1 },
    { unique: true, name: "project_page_template_unique" },
  );
}
