/**
 * Backend-only. This file defines MongoDB persistence document schemas
 * (gate sessions, `userIntelligence` profiles, fingerprint records, risk
 * events) and must never be reachable from `@powerotp/contracts/browser` —
 * see that file's doc comment. Nothing here is imported by
 * `@powerotp/gate-core` or `@powerotp/gate-node/browser`, and it must stay
 * that way.
 */
import { z } from "zod";

import { AsnTypeSchema } from "./botblocker-api-control.js";
import { BotBlockerChallengeStateSchema } from "./botblocker-challenge.js";
import {
  BotBlockerDecisionOutcomeSchema,
  BrowserEvidenceSchema,
  SiteIdSchema,
  TrustedProxyIpSchema,
} from "./botblocker.js";
import { VerificationTypeSchema } from "./verification.js";
import { CanonicalReportRequestSchema } from "./botblocker-api-runtime.js";
import {
  FINGERPRINT_COLLECTOR_VERSION,
  FINGERPRINT_VECTOR_VERSION,
  FingerprintComponentsSchema,
} from "./fingerprint.js";
import { FingerprintComponentValueSchemas } from "./fingerprint-components.js";
import { RiskEventScoreStatusSchema } from "./botblocker-risk-event-scoring.js";
import { ProfileScoreStatusSchema } from "./botblocker-scoring.js";

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
const Sha256DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Digest must be lowercase SHA-256 hex");

export const FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION = 1;

export const FingerprintDataRecordSchema = ScopedRecordSchema.extend({
  userIntelligenceId: OpaqueIdSchema,
  sourceGateSessionId: OpaqueIdSchema,
  fingerprintVersion: z.literal(FINGERPRINT_VECTOR_VERSION),
  collectorVersion: z.literal(FINGERPRINT_COLLECTOR_VERSION),
  components: FingerprintComponentsSchema,
  serverObservedAt: z.string().datetime(),
  firstObservedAt: z.string().datetime(),
  lastObservedAt: z.string().datetime(),
})
  .extend(RetainedRecordSchema.shape)
  .strict()
  .superRefine((record, context) => {
    if (
      Date.parse(record.lastObservedAt) < Date.parse(record.firstObservedAt) ||
      Date.parse(record.serverObservedAt) !== Date.parse(record.lastObservedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Fingerprint observation timestamps must be ordered",
        path: ["lastObservedAt"],
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

const normalizedText = z.string().max(1_024);
const normalizedTextArray = z.array(normalizedText).max(512);

export const FingerprintVerifySourceSchema = z
  .object({
    platformFamily: normalizedText,
    cpu: z.object({
      architecture: normalizedText,
      bitness: normalizedText,
      fingerprintArchitecture:
        FingerprintComponentValueSchemas.architecture,
    }).strict(),
    mobileModel: normalizedText,
    hardwareConcurrency:
      FingerprintComponentValueSchemas.hardwareConcurrency,
    deviceMemoryClass: FingerprintComponentValueSchemas.deviceMemory,
    maximumTouchPoints: z.number().int().min(0).max(1_024),
    display: z.object({
      shorterSide: z.number().int().min(0).max(1_000_000),
      longerSide: z.number().int().min(0).max(1_000_000),
      colorDepth: FingerprintComponentValueSchemas.colorDepth,
      colorGamut: FingerprintComponentValueSchemas.colorGamut,
    }).strict(),
    webGl: z.object({
      basics: FingerprintComponentValueSchemas.webGlBasics,
      contextAttributes: normalizedTextArray,
      parameters: normalizedTextArray,
      shaderPrecisions: normalizedTextArray,
      extensions: normalizedTextArray.nullable(),
      extensionParameters: normalizedTextArray,
      unsupportedExtensions: normalizedTextArray,
    }).strict(),
    canvas: FingerprintComponentValueSchemas.canvas,
    audio: z.object({
      value: FingerprintComponentValueSchemas.audio,
      baseLatency: FingerprintComponentValueSchemas.audioBaseLatency,
    }).strict(),
    fonts: FingerprintComponentValueSchemas.fonts,
    fontPreferences: FingerprintComponentValueSchemas.fontPreferences,
    browser: z.object({
      vendor: normalizedText,
      families: z.array(normalizedText).max(32),
    }).strict(),
  })
  .partial()
  .strict();

export const FingerprintVerifyLookupSchema = z.discriminatedUnion("status", [
  z.object({
    recipeVersion: z.literal(FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION),
    status: z.literal("available"),
    hash: ServerFingerprintHashSchema,
  }).strict(),
  z.object({
    recipeVersion: z.literal(FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION),
    status: z.literal("unavailable"),
    reason: z.enum(["missing_stable_inputs", "secret_unavailable"]),
  }).strict(),
]);

/** One exact-IP observation carried on `userIntelligence` — either the
 * profile's `currentIp` or one `recentIpHistory` entry. `asnScore` is the
 * observation-time configured ASN-type score (Phase 16 step 7) and is
 * omitted, never zero-substituted, when no network-range match was
 * available. `blacklisted` is the observation-time dedicated exact-IP
 * blacklist result and is never inferred from a decision outcome. */
export const IpEvidenceSchema = z
  .object({
    ip: TrustedProxyIpSchema,
    asnScore: z.number().int().optional(),
    blacklisted: z.boolean(),
  })
  .strict();

const IpReuseCountsSchema = z
  .object({
    distinctProfiles1d: z.number().int().nonnegative(),
    distinctProfiles7d: z.number().int().nonnegative(),
    distinctProfiles30d: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (counts) =>
      counts.distinctProfiles1d <= counts.distinctProfiles7d &&
      counts.distinctProfiles7d <= counts.distinctProfiles30d,
    { message: "Reuse counts must be monotonic across widening windows" },
  );

/** Separate system-wide and same-site distinct-profile counts for the
 * profile's current exact IP, over the latest 1/7/30 days. Risk evidence
 * only — never used to select, merge, or blacklist a profile. */
export const IpReuseSummarySchema = z
  .object({
    global: IpReuseCountsSchema,
    site: IpReuseCountsSchema,
  })
  .strict();

/** Session-level snapshot of the fast-immediate network/ASN classification
 * chain (Phase 16 step 7), taken once at gate-session creation. Purely
 * informational network input — no final weighted/thresholded decision is
 * derived from it here (Phase 17 scope). */
export const GateSessionNetworkClassificationSchema = z
  .object({
    asn: z.number().int().positive(),
    asnOrg: z.string().min(1).max(256),
    asnType: AsnTypeSchema,
    score: z.number().int(),
    requiresApiLookup: z.boolean(),
  })
  .strict();

/** Session-level snapshot of an awaited external vendor lookup, taken only
 * when the resolved ASN type required it. */
export const GateSessionIpReputationSchema = z
  .object({
    vendor: z.string().min(1).max(128),
    score: z.number(),
  })
  .strict();

export const CanonicalReportServerEvidenceSchema = z
  .object({
    ipBlacklisted: z.boolean().optional(),
    latestDecision: BotBlockerDecisionOutcomeSchema.optional(),
    networkClassification: GateSessionNetworkClassificationSchema.optional(),
    ipReputation: GateSessionIpReputationSchema.optional(),
  })
  .strict();

export const CanonicalReportSnapshotSchema = z
  .object({
    report: CanonicalReportRequestSchema,
    serverEvidence: CanonicalReportServerEvidenceSchema,
    serverObservedAt: z.string().datetime(),
  })
  .strict();

export const VisitorTokenMetadataSchema = z
  .object({
    tokenId: OpaqueIdSchema,
    expiresAt: z.string().datetime(),
    nonceDigest: Sha256DigestSchema,
    tokenDigest: Sha256DigestSchema,
  })
  .strict();

export const GateSessionRecordSchema = ScopedRecordSchema.extend({
  gateSessionId: OpaqueIdSchema,
  userIntelligenceId: OpaqueIdSchema,
  initialReport: CanonicalReportSnapshotSchema,
  tokenMetadata: VisitorTokenMetadataSchema.optional(),
  ip: TrustedProxyIpSchema.optional(),
  state: z.enum(["active", "ended"]),
  latestDecision: BotBlockerDecisionOutcomeSchema.optional(),
  networkClassification: GateSessionNetworkClassificationSchema.optional(),
  ipReputation: GateSessionIpReputationSchema.optional(),
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
      record.initialReport.report.siteId !== record.siteId ||
      record.initialReport.report.gateSessionId !== record.gateSessionId ||
      record.initialReport.report.reportSequence !== -1
    ) {
      context.addIssue({
        code: "custom",
        message: "Initial report must match its scoped gate session",
        path: ["initialReport", "report"],
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
  /** Internal authoritative Passport account reference, populated only
   * after server-side Passport verification. Never browser supplied. */
  passportUserId: OpaqueIdSchema.optional(),
  fingerprintVerifySource: FingerprintVerifySourceSchema.optional(),
  fingerprintVerifyLookup: FingerprintVerifyLookupSchema.optional(),
  osCpu: FingerprintComponentValueSchemas.osCpu.optional(),
  screenResolution:
    FingerprintComponentValueSchemas.screenResolution.optional(),
  platform: FingerprintComponentValueSchemas.platform.optional(),
  touchSupport: FingerprintComponentValueSchemas.touchSupport.optional(),
  vendor: FingerprintComponentValueSchemas.vendor.optional(),
  architecture: FingerprintComponentValueSchemas.architecture.optional(),
  applePay: FingerprintComponentValueSchemas.applePay.optional(),
  currentIp: IpEvidenceSchema.optional(),
  recentIpHistory: z.array(IpEvidenceSchema).max(20),
  currentIpReuse: IpReuseSummarySchema.optional(),
  currentScore: ProfileScoreStatusSchema.optional(),
  latestEvidence: BrowserEvidenceSchema.optional(),
  gateSessionCount: z.number().int().nonnegative(),
  behaviorReportCount: z.number().int().nonnegative(),
  pageViewCount: z.number().int().nonnegative().optional(),
  totalPageDurationMs: z.number().int().nonnegative().optional(),
  totalActiveDurationMs: z.number().int().nonnegative().optional(),
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
  reportSequence: z.number().int().min(-1),
  occurredAt: z.string().datetime(),
})
  .extend(RetainedRecordSchema.shape);

export const CanonicalRiskEventRecordSchema = RiskEventRecordBaseSchema.extend({
  recordType: z.literal("canonical_report"),
  report: CanonicalReportRequestSchema,
  serverEvidence: CanonicalReportServerEvidenceSchema,
  risk_event_score: RiskEventScoreStatusSchema,
  pageUrl: z.string().url().max(2_048).optional(),
})
  .strict()
  .superRefine((record, context) => {
    if (
      record.report.siteId !== record.siteId ||
      record.report.gateSessionId !== record.gateSessionId ||
      record.report.reportSequence !== record.reportSequence
    ) {
      context.addIssue({
        code: "custom",
        message: "Canonical report must match its scoped risk event",
        path: ["report"],
      });
    }
    const routePath = record.report.payload.behaviorReport?.evidence.routePath ??
      record.report.payload.browserEvidence?.routePath;
    if (record.pageUrl && routePath) {
      try {
        const pageUrl = new URL(record.pageUrl);
        if (
          pageUrl.username ||
          pageUrl.password ||
          pageUrl.search ||
          pageUrl.hash ||
          pageUrl.pathname !== routePath
        ) {
          context.addIssue({
            code: "custom",
            message: "pageUrl must be the authenticated origin plus sanitized report path",
            path: ["pageUrl"],
          });
        }
      } catch {
        // The URL schema above reports malformed values.
      }
    }
    if (Date.parse(record.retentionExpiresAt) <= Date.parse(record.occurredAt)) {
      context.addIssue({
        code: "custom",
        message: "retentionExpiresAt must follow occurredAt",
        path: ["retentionExpiresAt"],
      });
    }
  });

export const DurableRiskEventRecordSchema = CanonicalRiskEventRecordSchema;

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
export type CanonicalReportSnapshot = z.infer<
  typeof CanonicalReportSnapshotSchema
>;
export type VisitorTokenMetadata = z.infer<typeof VisitorTokenMetadataSchema>;
export type UserIntelligenceRecord = z.infer<typeof UserIntelligenceRecordSchema>;
export type FingerprintDataRecord = z.infer<typeof FingerprintDataRecordSchema>;
export type FingerprintVerifySource = z.infer<
  typeof FingerprintVerifySourceSchema
>;
export type FingerprintVerifyLookup = z.infer<
  typeof FingerprintVerifyLookupSchema
>;
export type IpEvidence = z.infer<typeof IpEvidenceSchema>;
export type IpReuseSummary = z.infer<typeof IpReuseSummarySchema>;
export type DurableRiskEventRecord = z.infer<typeof DurableRiskEventRecordSchema>;
export type BotBlockerChallengeRecord = z.infer<
  typeof BotBlockerChallengeRecordSchema
>;
