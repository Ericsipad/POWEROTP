import { z } from "zod";

import { BotBlockerChallengeStateSchema } from "./botblocker-challenge.js";
import { RiskEventSchema } from "./botblocker-proofs.js";
import {
  BehaviorReportSchema,
  BotBlockerDecisionOutcomeSchema,
  BrowserEvidenceSchema,
  ReportSequenceSchema,
  SiteIdSchema,
} from "./botblocker.js";
import { VerificationTypeSchema } from "./verification.js";

const OpaqueIdSchema = z.string().min(16).max(128);
const ScopedRecordSchema = z.object({
  customerId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  siteId: SiteIdSchema,
});
const RetainedRecordSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  retentionExpiresAt: z.string().datetime(),
});

export const ServerFingerprintHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Fingerprint hash must be lowercase SHA-256 hex");

/** A keyed, server-derived lookup value. The raw IP is intentionally absent
 * from every durable contract, and this value is never a unique identity. */
export const ServerIpHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "IP hash must be lowercase SHA-256 hex");

export const IpObservationSchema = z
  .object({
    ipHash: ServerIpHashSchema,
    firstObservedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime(),
    observationCount: z.number().int().positive(),
  })
  .strict()
  .refine(
    (observation) =>
      Date.parse(observation.lastObservedAt) >=
      Date.parse(observation.firstObservedAt),
    { message: "lastObservedAt cannot precede firstObservedAt" },
  );

export const GateSessionRecordSchema = ScopedRecordSchema.extend({
  gateSessionId: OpaqueIdSchema,
  userIntelligenceId: OpaqueIdSchema,
  fingerprintHash: ServerFingerprintHashSchema,
  ipHash: ServerIpHashSchema.optional(),
  state: z.enum(["active", "ended"]),
  latestDecision: BotBlockerDecisionOutcomeSchema.optional(),
  lastAppliedSequence: z.number().int().min(-1),
  startedAt: z.string().datetime(),
  lastObservedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
})
  .extend(RetainedRecordSchema.shape)
  .strict()
  .superRefine((record, context) => {
    if (record.state === "ended" && !record.endedAt) {
      context.addIssue({
        code: "custom",
        message: "Ended gate sessions require endedAt",
        path: ["endedAt"],
      });
    }
    if (
      Date.parse(record.retentionExpiresAt) <= Date.parse(record.lastObservedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "retentionExpiresAt must follow lastObservedAt",
        path: ["retentionExpiresAt"],
      });
    }
  });

export const UserIntelligenceRecordSchema = ScopedRecordSchema.extend({
  userIntelligenceId: OpaqueIdSchema,
  fingerprintHash: ServerFingerprintHashSchema,
  ipObservations: z.array(IpObservationSchema),
  latestEvidence: BrowserEvidenceSchema.optional(),
  gateSessionCount: z.number().int().nonnegative(),
  behaviorReportCount: z.number().int().nonnegative(),
  firstObservedAt: z.string().datetime(),
  lastObservedAt: z.string().datetime(),
})
  .extend(RetainedRecordSchema.shape)
  .strict()
  .refine(
    (record) =>
      Date.parse(record.retentionExpiresAt) > Date.parse(record.lastObservedAt),
    {
      message: "retentionExpiresAt must follow lastObservedAt",
      path: ["retentionExpiresAt"],
    },
  );

const RiskEventRecordBaseSchema = ScopedRecordSchema.extend({
  riskEventId: OpaqueIdSchema,
  userIntelligenceId: OpaqueIdSchema,
  gateSessionId: OpaqueIdSchema,
  reportSequence: z.number().int().nonnegative(),
  eventIndex: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
})
  .extend(RetainedRecordSchema.shape);

export const BehaviorReportEventRecordSchema = RiskEventRecordBaseSchema.extend({
  recordType: z.literal("behavior_report"),
  eventIndex: z.literal(0),
  report: BehaviorReportSchema,
})
  .strict()
  .superRefine((record, context) => {
    if (
      record.report.sequence.gateSessionId !== record.gateSessionId ||
      record.report.sequence.sequence !== record.reportSequence
    ) {
      context.addIssue({
        code: "custom",
        message: "Behavior report sequence must match its scoped persistence record",
        path: ["report", "sequence"],
      });
    }
    if (Date.parse(record.retentionExpiresAt) <= Date.parse(record.occurredAt)) {
      context.addIssue({
        code: "custom",
        message: "retentionExpiresAt must follow occurredAt",
        path: ["retentionExpiresAt"],
      });
    }
  });

export const RiskSignalEventRecordSchema = RiskEventRecordBaseSchema.extend({
  recordType: z.literal("risk_signal"),
  eventIndex: z.number().int().positive(),
  sequence: ReportSequenceSchema,
  event: RiskEventSchema,
})
  .strict()
  .superRefine((record, context) => {
    if (
      record.sequence.gateSessionId !== record.gateSessionId ||
      record.sequence.sequence !== record.reportSequence
    ) {
      context.addIssue({
        code: "custom",
        message: "Risk-event sequence must match its scoped persistence record",
        path: ["sequence"],
      });
    }
    if (Date.parse(record.retentionExpiresAt) <= Date.parse(record.occurredAt)) {
      context.addIssue({
        code: "custom",
        message: "retentionExpiresAt must follow occurredAt",
        path: ["retentionExpiresAt"],
      });
    }
  });

export const DurableRiskEventRecordSchema = z.discriminatedUnion("recordType", [
  BehaviorReportEventRecordSchema,
  RiskSignalEventRecordSchema,
]);

export const BotBlockerChallengeRecordSchema = ScopedRecordSchema.extend({
  challengeId: OpaqueIdSchema,
  userIntelligenceId: OpaqueIdSchema,
  gateSessionId: OpaqueIdSchema,
  state: BotBlockerChallengeStateSchema,
  verificationType: VerificationTypeSchema.optional(),
  verificationRequestId: OpaqueIdSchema.optional(),
  verificationResult: z.enum(["succeeded", "failed"]).optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  presentedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
})
  .extend(RetainedRecordSchema.shape)
  .strict()
  .superRefine((record, context) => {
    if (Date.parse(record.expiresAt) <= Date.parse(record.issuedAt)) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must follow issuedAt",
        path: ["expiresAt"],
      });
    }
    if (Date.parse(record.retentionExpiresAt) <= Date.parse(record.updatedAt)) {
      context.addIssue({
        code: "custom",
        message: "retentionExpiresAt must follow updatedAt",
        path: ["retentionExpiresAt"],
      });
    }
    if (
      record.verificationResult &&
      (!record.verificationType || !record.verificationRequestId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification results require an authoritative OTP reference",
        path: ["verificationResult"],
      });
    }
  });

export type GateSessionRecord = z.infer<typeof GateSessionRecordSchema>;
export type UserIntelligenceRecord = z.infer<typeof UserIntelligenceRecordSchema>;
export type DurableRiskEventRecord = z.infer<typeof DurableRiskEventRecordSchema>;
export type BotBlockerChallengeRecord = z.infer<
  typeof BotBlockerChallengeRecordSchema
>;
