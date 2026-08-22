import {
  HostedPersonIdentityIdSchema,
  ProjectIdentityBindingIdSchema,
  ProjectUserIdSchema,
} from "@powerotp/contracts";
import { z } from "zod";

const ProjectIdSchema = z.string().min(16).max(200);
const OpaqueSecurityEventIdSchema = z
  .string()
  .regex(/^hse_[A-Za-z0-9_-]{43}$/, "Expected an opaque security-event ID");
const BunnyAssetReferenceSchema = z
  .string()
  .regex(/^basset_[A-Za-z0-9_-]{43}$/, "Expected an opaque Bunny asset reference");
const CanonicalReferenceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,31}:[A-Za-z0-9_-]{8,200}$/);
const CanonicalCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/);
const CorrelationIdSchema = z.string().min(16).max(200);

export const ProjectIdentityBindingRecordSchema = z
  .object({
    bindingId: ProjectIdentityBindingIdSchema,
    projectId: ProjectIdSchema,
    hostedPersonIdentityId: HostedPersonIdentityIdSchema,
    projectUserId: ProjectUserIdSchema,
    status: z.enum(["active", "suspended", "deleted"]),
    derivationVersion: z.number().int().positive(),
    createdAt: z.date(),
    lastAuthenticatedAt: z.date().optional(),
  })
  .strict()
  .refine(
    (record) =>
      record.lastAuthenticatedAt === undefined ||
      record.lastAuthenticatedAt >= record.createdAt,
    {
      message: "Last authentication cannot precede binding creation",
      path: ["lastAuthenticatedAt"],
    },
  );

export type ProjectIdentityBindingRecord = z.infer<
  typeof ProjectIdentityBindingRecordSchema
>;
export interface ProjectIdentityBindingDocument
  extends Omit<ProjectIdentityBindingRecord, "bindingId"> {
  _id: string;
}

export const WrappedIdentityKeyRecordSchema = z
  .object({
    hostedPersonIdentityId: HostedPersonIdentityIdSchema,
    kmsKeyVersion: CanonicalCodeSchema,
    wrappedDekCiphertext: z
      .string()
      .min(43)
      .max(8_192)
      .regex(/^[A-Za-z0-9_-]+$/, "Expected unpadded base64url ciphertext")
      .optional(),
    status: z.enum(["active", "crypto_shredded"]),
    createdAt: z.date(),
    cryptoShreddedAt: z.date().optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.status === "active" &&
      record.wrappedDekCiphertext === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "An active key record requires wrapped DEK ciphertext",
        path: ["wrappedDekCiphertext"],
      });
    }
    if (
      record.status === "crypto_shredded" &&
      (record.wrappedDekCiphertext !== undefined ||
        record.cryptoShreddedAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A crypto-shredded record must remove ciphertext and record its timestamp",
        path: ["status"],
      });
    }
    if (
      record.cryptoShreddedAt !== undefined &&
      record.cryptoShreddedAt < record.createdAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Crypto-shredding cannot precede key creation",
        path: ["cryptoShreddedAt"],
      });
    }
  });

export type WrappedIdentityKeyRecord = z.infer<
  typeof WrappedIdentityKeyRecordSchema
>;

const RichTextMarksSchema = z
  .array(z.enum(["bold", "italic", "underline"]))
  .max(3)
  .refine(
    (marks) =>
      new Set(marks).size === marks.length &&
      marks.every((mark, index) => index === 0 || marks[index - 1]! < mark),
    "Marks must be unique and sorted",
  );
const RichTextLeafSchema = z
  .object({
    text: z.string().max(4_000),
    marks: RichTextMarksSchema.default([]),
    fontFamily: z
      .enum(["system", "sans_serif", "serif", "monospace"])
      .default("system"),
    fontSize: z.enum(["small", "medium", "large"]).default("medium"),
  })
  .strict();
const RichTextBlockSchema = z
  .object({
    type: z.enum(["paragraph", "unordered_list_item", "ordered_list_item"]),
    children: z.array(RichTextLeafSchema).min(1).max(64),
  })
  .strict();
export const HostedAuthRichTextDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    blocks: z.array(RichTextBlockSchema).max(32),
  })
  .strict();

const HostedAuthTemplateRowSchema = z
  .object({
    enabled: z.boolean(),
    richText: HostedAuthRichTextDocumentSchema,
    image: z
      .object({
        assetReference: BunnyAssetReferenceSchema,
        altText: z.string().min(1).max(500),
      })
      .strict()
      .optional(),
  })
  .strict();

export const HostedAuthPageTemplateRecordSchema = z
  .object({
    projectId: ProjectIdSchema,
    pageType: z.enum(["signup", "signin"]),
    templateType: z.literal("template_1"),
    rows: z
      .object({
        A: HostedAuthTemplateRowSchema,
        B: HostedAuthTemplateRowSchema,
        C: HostedAuthTemplateRowSchema,
        D: HostedAuthTemplateRowSchema,
        E: HostedAuthTemplateRowSchema,
        F: HostedAuthTemplateRowSchema,
      })
      .strict(),
    adPositionsEnabled: z.tuple([
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
    ]),
    revision: z.number().int().nonnegative(),
    updatedAt: z.date(),
    updatedBy: CanonicalReferenceSchema,
  })
  .strict();

export type HostedAuthPageTemplateRecord = z.infer<
  typeof HostedAuthPageTemplateRecordSchema
>;

const SecurityEventChangedFieldsSchema = z
  .array(CanonicalCodeSchema)
  .max(32)
  .refine(
    (fields) =>
      new Set(fields).size === fields.length &&
      fields.every((field, index) => index === 0 || fields[index - 1]! < field),
    "Changed fields must be unique and sorted",
  );

export const HostedAuthSecurityEventRecordSchema = z
  .object({
    eventId: OpaqueSecurityEventIdSchema,
    projectId: ProjectIdSchema.optional(),
    eventType: z.enum([
      "credential_changed",
      "project_auth_configuration_changed",
      "wrapped_key_changed",
      "identity_deletion_changed",
      "abuse_detected",
      "privileged_support_accessed",
    ]),
    actorType: z.enum(["hosted_auth_service", "project_admin", "operator"]),
    actorReference: CanonicalReferenceSchema,
    targetType: z.enum([
      "auth_profile",
      "credential",
      "project_binding",
      "project_configuration",
      "wrapped_key",
      "person_identity",
    ]),
    targetReference: CanonicalReferenceSchema,
    changedFields: SecurityEventChangedFieldsSchema,
    outcome: z.enum(["succeeded", "denied", "failed"]),
    reasonCode: CanonicalCodeSchema.optional(),
    correlationId: CorrelationIdSchema,
    occurredAt: z.date(),
    retentionExpiresAt: z.date(),
  })
  .strict()
  .refine(
    (event) => event.retentionExpiresAt > event.occurredAt,
    "Security-event retention expiry must follow occurrence",
  );

export type HostedAuthSecurityEventRecord = z.infer<
  typeof HostedAuthSecurityEventRecordSchema
>;
export interface HostedAuthSecurityEventDocument
  extends Omit<HostedAuthSecurityEventRecord, "eventId"> {
  _id: string;
}
