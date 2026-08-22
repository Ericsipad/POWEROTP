import {
  HostedAuthBalanceTransactionIdSchema,
  HostedAuthBillableMethodSchema,
  HostedAuthFailureReasonSchema,
  HostedAuthFlowSchema,
  HostedAuthProviderOperationIdSchema,
  HostedAuthRequestIdSchema,
  ProjectIdentityBindingIdSchema,
  terminalHostedAuthRequestStates,
} from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";
import { z } from "zod";

export const HOSTED_AUTH_RETENTION_DATABASE_NAME = "powerotp_auth_retention";
export const HOSTED_AUTH_RETENTION_COLLECTION_NAME = "authRequestRetention";

const CanonicalLevelSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "Expected a canonical level identifier");
const CanonicalLevelsSchema = z
  .array(CanonicalLevelSchema)
  .max(16)
  .refine(
    (levels) =>
      new Set(levels).size === levels.length &&
      levels.every((level, index) => index === 0 || levels[index - 1]! < level),
    "Levels must be unique and sorted",
  );
const AuthenticationMethodSchema = z.union([
  z.enum(["webauthn", "recovery_code"]),
  HostedAuthBillableMethodSchema,
]);
const CorrelationIdSchema = z.string().min(16).max(200);

export const HostedAuthRetentionRecordSchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    projectId: z.string().min(16).max(200),
    flow: HostedAuthFlowSchema,
    method: AuthenticationMethodSchema,
    bindingReference: ProjectIdentityBindingIdSchema.optional(),
    providerOperationReference: HostedAuthProviderOperationIdSchema.optional(),
    balanceTransactionId: HostedAuthBalanceTransactionIdSchema.optional(),
    assuranceLevels: CanonicalLevelsSchema,
    verificationLevels: CanonicalLevelsSchema,
    outcome: z.enum(terminalHostedAuthRequestStates),
    failureReason: HostedAuthFailureReasonSchema.optional(),
    correlationId: CorrelationIdSchema,
    createdAt: z.date(),
    completedAt: z.date(),
    retentionExpiresAt: z.date(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.completedAt < record.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Completion cannot precede request creation",
        path: ["completedAt"],
      });
    }
    if (record.retentionExpiresAt <= record.completedAt) {
      context.addIssue({
        code: "custom",
        message: "Retention expiry must follow completion",
        path: ["retentionExpiresAt"],
      });
    }
    if (record.outcome === "succeeded" && record.failureReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Successful retention records cannot contain a failure reason",
        path: ["failureReason"],
      });
    }
    if (record.outcome !== "succeeded" && record.failureReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Non-success retention records require a stable failure reason",
        path: ["failureReason"],
      });
    }
  });

export type HostedAuthRetentionRecord = z.infer<
  typeof HostedAuthRetentionRecordSchema
>;
export type HostedAuthTerminalRetentionDetails = Omit<
  HostedAuthRetentionRecord,
  "authRequestId" | "projectId" | "flow" | "outcome" | "createdAt" | "completedAt"
>;

export interface HostedAuthRetentionDocument
  extends Omit<HostedAuthRetentionRecord, "authRequestId"> {
  _id: string;
}

type RetentionCollection = Pick<
  Collection<HostedAuthRetentionDocument>,
  "createIndex" | "findOne" | "updateOne"
>;

export interface HostedAuthRetentionWriter {
  retain(
    input: HostedAuthRetentionRecord,
  ): Promise<"inserted" | "duplicate">;
}

export function hostedAuthRetentionDatabase(dbClient: {
  db(name: string): Db;
}): Db {
  return dbClient.db(HOSTED_AUTH_RETENTION_DATABASE_NAME);
}

export async function ensureHostedAuthRetentionIndexes(db: Db): Promise<void> {
  const retention = db.collection<HostedAuthRetentionDocument>(
    HOSTED_AUTH_RETENTION_COLLECTION_NAME,
  );
  await Promise.all([
    retention.createIndex(
      { retentionExpiresAt: 1 },
      { expireAfterSeconds: 0, name: "retentionExpiresAt_ttl" },
    ),
    retention.createIndex(
      { projectId: 1, completedAt: -1 },
      { name: "project_completed" },
    ),
    retention.createIndex(
      { correlationId: 1 },
      { name: "correlation_lookup" },
    ),
  ]);
}

function retainedFields(document: HostedAuthRetentionDocument) {
  const { _id, ...fields } = document;
  return { authRequestId: _id, ...fields };
}

export class HostedAuthRetentionRepository
  implements HostedAuthRetentionWriter
{
  private readonly retention: RetentionCollection;

  constructor(db: Db, collection?: RetentionCollection) {
    this.retention =
      collection ??
      db.collection<HostedAuthRetentionDocument>(
        HOSTED_AUTH_RETENTION_COLLECTION_NAME,
      );
  }

  async retain(
    input: HostedAuthRetentionRecord,
  ): Promise<"inserted" | "duplicate"> {
    const record = HostedAuthRetentionRecordSchema.parse(input);
    const { authRequestId, ...fields } = record;
    const document: HostedAuthRetentionDocument = {
      _id: authRequestId,
      ...fields,
    };
    const result = await this.retention.updateOne(
      { _id: authRequestId },
      { $setOnInsert: document },
      { upsert: true },
    );
    if (result.upsertedCount === 1) return "inserted";

    const existing = await this.retention.findOne({ _id: authRequestId });
    if (
      existing &&
      JSON.stringify(HostedAuthRetentionRecordSchema.parse(retainedFields(existing))) ===
        JSON.stringify(record)
    ) {
      return "duplicate";
    }
    throw new Error("Conflicting hosted-auth retention record");
  }
}
