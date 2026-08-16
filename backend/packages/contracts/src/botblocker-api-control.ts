import { z } from "zod";

import {
  BotBlockerDecisionOutcomeSchema,
  SiteIdSchema,
} from "./botblocker.js";
import {
  BotBlockerPolicySchema,
  SignedBotBlockerPolicyReleaseSchema,
} from "./botblocker-policy.js";
import { PolicyReleaseRecordSchema } from "./botblocker-policy-persistence.js";

const OpaqueIdSchema = z.string().min(16).max(128);
const CursorSchema = z.string().min(1).max(512);
const PageLimitSchema = z.number().int().min(1).max(200);

/** Customer route query. Project scope comes from the authenticated route
 * and is deliberately not accepted as a body-level ownership claim. */
export const CustomerVisitorsQuerySchema = z
  .object({
    siteId: SiteIdSchema.optional(),
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema.default(50),
  })
  .strict();

/** Purpose-limited visitor summary. It excludes raw events, IP/fingerprint
 * hashes, internal correlation, scores, weights, and other tenants' data. */
export const CustomerVisitorSchema = z
  .object({
    visitorId: OpaqueIdSchema,
    siteId: SiteIdSchema,
    latestDecision: BotBlockerDecisionOutcomeSchema.optional(),
    gateSessionCount: z.number().int().nonnegative(),
    behaviorReportCount: z.number().int().nonnegative(),
    pageViewCount: z.number().int().nonnegative(),
    totalPageDurationMs: z.number().int().nonnegative(),
    totalActiveDurationMs: z.number().int().nonnegative(),
    firstObservedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime(),
  })
  .strict();

export const CustomerVisitorsResponseSchema = z
  .object({
    visitors: z.array(CustomerVisitorSchema).max(200),
    nextCursor: CursorSchema.optional(),
  })
  .strict();

export const rapidListKinds = ["allow", "blacklist"] as const;
export const RapidListKindSchema = z.enum(rapidListKinds);
export const rapidListIndicatorKinds = [
  "ip_prefix",
  "asn",
  "fingerprint_hash",
  "passport_subject",
] as const;
export const RapidListIndicatorKindSchema = z.enum(rapidListIndicatorKinds);

export const OperatorRapidListMutationSchema = z
  .object({
    kind: RapidListKindSchema,
    indicatorKind: RapidListIndicatorKindSchema,
    indicator: z.string().min(1).max(512),
    reason: z.string().min(1).max(1_000),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const OperatorRapidListQuerySchema = z
  .object({
    kind: RapidListKindSchema.optional(),
    indicatorKind: RapidListIndicatorKindSchema.optional(),
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema.default(50),
  })
  .strict();

export const OperatorRapidListEntrySchema = OperatorRapidListMutationSchema.extend({
  entryId: OpaqueIdSchema,
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
}).strict();

export const OperatorRapidListResponseSchema = z
  .object({
    entries: z.array(OperatorRapidListEntrySchema).max(200),
    nextCursor: CursorSchema.optional(),
  })
  .strict();

export const OperatorDecisionTraceQuerySchema = z
  .object({
    gateSessionId: OpaqueIdSchema,
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema.default(50),
  })
  .strict();

export const decisionTraceStages = [
  "rapid_auth",
  "browser_assessment",
  "risk_event",
  "challenge",
  "policy",
] as const;
export const DecisionTraceStageSchema = z.enum(decisionTraceStages);

/** A trace records authoritative outcomes and provenance without exposing
 * proprietary scores/weights or accepting either from the operator. */
export const OperatorDecisionTraceEntrySchema = z
  .object({
    traceId: OpaqueIdSchema,
    gateSessionId: OpaqueIdSchema,
    stage: DecisionTraceStageSchema,
    outcome: BotBlockerDecisionOutcomeSchema.optional(),
    reasonCode: z.string().min(1).max(128),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const OperatorDecisionTraceResponseSchema = z
  .object({
    entries: z.array(OperatorDecisionTraceEntrySchema).max(200),
    nextCursor: CursorSchema.optional(),
  })
  .strict();

export const operatorHealthStates = ["healthy", "degraded", "unavailable"] as const;
export const OperatorHealthStateSchema = z.enum(operatorHealthStates);
export const OperatorDependencyHealthSchema = z
  .object({
    name: z.string().min(1).max(128),
    state: OperatorHealthStateSchema,
    checkedAt: z.string().datetime(),
  })
  .strict();
export const OperatorBotBlockerHealthResponseSchema = z
  .object({
    state: OperatorHealthStateSchema,
    checkedAt: z.string().datetime(),
    dependencies: z.array(OperatorDependencyHealthSchema).max(50),
  })
  .strict();

/** The operator supplies the existing unsigned policy schema. Signing,
 * publication identity, ownership, and success are server-derived. */
export const OperatorPolicyPublicationRequestSchema = z
  .object({ policy: BotBlockerPolicySchema })
  .strict();
export const OperatorPolicyPublicationResponseSchema = z
  .object({ release: SignedBotBlockerPolicyReleaseSchema })
  .strict();
export const OperatorPolicyReleaseListResponseSchema = z
  .object({ releases: z.array(PolicyReleaseRecordSchema).max(200) })
  .strict();

export type CustomerVisitorsQuery = z.infer<typeof CustomerVisitorsQuerySchema>;
export type CustomerVisitor = z.infer<typeof CustomerVisitorSchema>;
export type CustomerVisitorsResponse = z.infer<typeof CustomerVisitorsResponseSchema>;
export type RapidListKind = z.infer<typeof RapidListKindSchema>;
export type RapidListIndicatorKind = z.infer<typeof RapidListIndicatorKindSchema>;
export type OperatorRapidListMutation = z.infer<
  typeof OperatorRapidListMutationSchema
>;
export type OperatorRapidListQuery = z.infer<typeof OperatorRapidListQuerySchema>;
export type OperatorRapidListEntry = z.infer<typeof OperatorRapidListEntrySchema>;
export type OperatorDecisionTraceQuery = z.infer<
  typeof OperatorDecisionTraceQuerySchema
>;
export type OperatorDecisionTraceEntry = z.infer<
  typeof OperatorDecisionTraceEntrySchema
>;
export type OperatorBotBlockerHealthResponse = z.infer<
  typeof OperatorBotBlockerHealthResponseSchema
>;
export type OperatorPolicyPublicationRequest = z.infer<
  typeof OperatorPolicyPublicationRequestSchema
>;
export type OperatorPolicyPublicationResponse = z.infer<
  typeof OperatorPolicyPublicationResponseSchema
>;
