import { z } from "zod";

import {
  BotBlockerDecisionOutcomeSchema,
  SiteIdSchema,
  TrustedProxyIpSchema,
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

/** Purpose-limited visitor summary. It excludes raw events, fingerprint
 * hashes, internal correlation, scores, weights, and other tenants' data.
 * It includes the visitor's most recently observed raw IP (not a hash) so
 * the site owner's own visitor report can display it; an IP alone is never
 * identity evidence elsewhere in BotBlocker. */
export const CustomerVisitorSchema = z
  .object({
    visitorId: OpaqueIdSchema,
    siteId: SiteIdSchema,
    ip: TrustedProxyIpSchema.optional(),
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

export const botBlockerIpFamilies = ["v4", "v6"] as const;
export const BotBlockerIpFamilySchema = z.enum(botBlockerIpFamilies);

/**
 * `botblockerIpBlacklistV4`/`V6` (Phase 16 network-intelligence design): a
 * small, dedicated, exact-IP-match table checked before the ASN/subnet
 * range lookup so a known-bad IP short-circuits to `otp` without touching
 * the larger network-classification tables. This is the only admin-facing
 * BotBlocker override; there is no separate generic allow/blacklist
 * mechanism (see the plan doc's "Corrections made during this design
 * session," item 2).
 */
export const ipBlacklistProvenanceKinds = [
  "operator_manual",
  "automatic_detection",
] as const;
export const IpBlacklistProvenanceSchema = z.enum(ipBlacklistProvenanceKinds);

/** Adding an IP that already has an entry (active or revoked) refreshes
 * that entry in place — reason/provenance/expiry update and any prior
 * revocation clears — rather than erroring or creating a duplicate row,
 * since the underlying collection enforces one row per raw IP. */
export const OperatorIpBlacklistMutationSchema = z
  .object({
    ip: TrustedProxyIpSchema,
    reason: z.string().min(1).max(1_000),
    provenance: IpBlacklistProvenanceSchema,
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const OperatorIpBlacklistEntrySchema = z
  .object({
    entryId: OpaqueIdSchema,
    family: BotBlockerIpFamilySchema,
    ip: TrustedProxyIpSchema,
    reason: z.string().min(1).max(1_000),
    provenance: IpBlacklistProvenanceSchema,
    expiresAt: z.string().datetime().optional(),
    revokedAt: z.string().datetime().optional(),
    createdBy: OpaqueIdSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const OperatorIpBlacklistMutationResponseSchema = z
  .object({ entry: OperatorIpBlacklistEntrySchema })
  .strict();

export const OperatorIpBlacklistQuerySchema = z
  .object({
    family: BotBlockerIpFamilySchema,
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema.default(50),
  })
  .strict();

export const OperatorIpBlacklistListResponseSchema = z
  .object({
    entries: z.array(OperatorIpBlacklistEntrySchema).max(200),
    nextCursor: CursorSchema.optional(),
  })
  .strict();

export const OperatorIpBlacklistRevokeRequestSchema = z
  .object({ entryId: OpaqueIdSchema })
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
export type BotBlockerIpFamily = z.infer<typeof BotBlockerIpFamilySchema>;
export type IpBlacklistProvenance = z.infer<typeof IpBlacklistProvenanceSchema>;
export type OperatorIpBlacklistMutation = z.infer<
  typeof OperatorIpBlacklistMutationSchema
>;
export type OperatorIpBlacklistEntry = z.infer<
  typeof OperatorIpBlacklistEntrySchema
>;
export type OperatorIpBlacklistQuery = z.infer<
  typeof OperatorIpBlacklistQuerySchema
>;
export type OperatorIpBlacklistRevokeRequest = z.infer<
  typeof OperatorIpBlacklistRevokeRequestSchema
>;
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
