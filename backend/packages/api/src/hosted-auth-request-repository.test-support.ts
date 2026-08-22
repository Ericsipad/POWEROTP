import { hostedAuthRealms } from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

import type {
  HostedAuthRetentionRecord,
  HostedAuthRetentionWriter,
} from "./hosted-auth-retention-repository.js";
import {
  HostedAuthRequestRepository,
  type HostedAuthRequestDocument,
} from "./hosted-auth-request-repository.js";

export const body = "A".repeat(43);
export const authRequestId = `har_${body}`;
export const pollToken = `hpt_${body}`;
export const scope = {
  projectId: "project_12345678",
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup" as const,
};
export const successRetention = {
  method: "webauthn" as const,
  assuranceLevels: ["aal2"],
  verificationLevels: ["contact_verified"],
  correlationId: "correlation_123456",
  retentionExpiresAt: new Date("2027-08-22T01:00:00.000Z"),
};

export class MemoryHostedAuthRequestCollection {
  readonly documents = new Map<string, HostedAuthRequestDocument>();
  readonly indexes: Array<{ keys: object; options: object }> = [];

  constructor(private readonly events: string[] = []) {}

  async createIndex(keys: object, options: object) {
    this.indexes.push({ keys, options });
    return String(options);
  }

  async insertOne(document: HostedAuthRequestDocument) {
    this.documents.set(document._id, structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }

  async findOne(filter: Record<string, unknown>) {
    const document = this.documents.get(String(filter._id));
    if (
      !document ||
      (filter["scope.projectId"] !== undefined &&
        document.scope.projectId !== filter["scope.projectId"]) ||
      (filter["scope.flow"] !== undefined &&
        document.scope.flow !== filter["scope.flow"])
    ) {
      return null;
    }
    return structuredClone(document);
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Partial<HostedAuthRequestDocument> },
  ) {
    this.events.push("publish");
    const document = this.documents.get(String(filter._id));
    const expiresAt = filter.expiresAt as { $gt?: Date } | undefined;
    const terminal = ["succeeded", "failed", "canceled", "expired"];
    if (
      !document ||
      document.scope.projectId !== filter["scope.projectId"] ||
      terminal.includes(document.state) ||
      (expiresAt?.$gt && document.expiresAt <= expiresAt.$gt)
    ) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }
    this.documents.set(document._id, { ...document, ...update.$set });
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter: Record<string, unknown>) {
    const document = this.documents.get(String(filter._id));
    if (
      document &&
      (!(filter.purgeAt instanceof Date) ||
        filter.purgeAt.getTime() === document.purgeAt.getTime())
    ) {
      this.documents.delete(document._id);
      return { acknowledged: true, deletedCount: 1 };
    }
    return { acknowledged: true, deletedCount: 0 };
  }
}

export class MemoryHostedAuthRetentionWriter
  implements HostedAuthRetentionWriter
{
  readonly records: HostedAuthRetentionRecord[] = [];

  constructor(
    private readonly events: string[] = [],
    private readonly failure?: Error,
  ) {}

  async retain(input: HostedAuthRetentionRecord) {
    this.events.push("retain");
    if (this.failure) throw this.failure;
    this.records.push(structuredClone(input));
    return "inserted" as const;
  }
}

export function requestRepository(
  collection = new MemoryHostedAuthRequestCollection(),
  retention: HostedAuthRetentionWriter = new MemoryHostedAuthRetentionWriter(),
) {
  return {
    collection,
    repository: new HostedAuthRequestRepository(
      {} as Db,
      "result-encryption-key".repeat(2),
      retention,
      collection as unknown as Collection<HostedAuthRequestDocument>,
    ),
  };
}
