import { z } from "zod";

/**
 * BotBlocker base protocol contracts (Phase 1 of
 * `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`), extended in Phase 2
 * with the real `allow | otp` decision-outcome union. This file defines the
 * shared envelope, timeout, request-context, sanitized browser-evidence,
 * behavior-report, decision-revision-envelope (now carrying that outcome),
 * and error/unavailable shapes — see `docs/POWEROTP_BOTBLOCKER_PLAN.md` for
 * the product/architecture spec and `docs/THREAT_MODEL.md`'s "BotBlocker
 * threat model" section for the controls these contracts must not
 * contradict. Challenge/policy/clearance/Passport/PaidTokenPass/risk-event
 * contracts live in sibling `botblocker-*.ts` files added in Phase 2 (see
 * `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md#phase-2--decision-challenge-and-proof-contracts`)
 * and reuse the exports here rather than duplicating them. Ed25519 signing
 * is Phase 3 — nothing here fabricates a score or approval.
 */

// ---------------------------------------------------------------------------
// Versioned identifiers
// ---------------------------------------------------------------------------

/**
 * The BotBlocker wire-protocol version every adapter (gate-node,
 * gate-express, gate-next) and the central API must agree on. Bumped only
 * for a breaking change to a shape in this file. There is exactly one
 * supported value today; a negotiation/rejection path for a mismatch is
 * added once the central API surface exists (Phase 8), not here.
 */
export const BOTBLOCKER_PROTOCOL_VERSION = 1;
export const BotBlockerProtocolVersionSchema = z.literal(BOTBLOCKER_PROTOCOL_VERSION);

/**
 * The version of this contracts module, independent of the wire-protocol
 * version above — bumped whenever any schema in this file changes shape,
 * even backward-compatibly. Carried for diagnostics/observability only
 * (e.g. telling apart "older contracts build, still wire-compatible" from
 * a genuine protocol break); it never gates acceptance by itself.
 */
export const BOTBLOCKER_CONTRACT_VERSION = "2026-08-16.1";
export const BotBlockerContractVersionSchema = z.literal(BOTBLOCKER_CONTRACT_VERSION);

// ---------------------------------------------------------------------------
// Timeout contract
// ---------------------------------------------------------------------------

export const BOTBLOCKER_TIMEOUT_MIN_MS = 50;
export const BOTBLOCKER_TIMEOUT_MAX_MS = 2_000;
export const BOTBLOCKER_TIMEOUT_DEFAULT_MS = 200;

/**
 * The customer-configurable decision-timeout UX setting (see
 * `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s Purpose section). This is a
 * responsiveness value, never a security boundary — see
 * `docs/THREAT_MODEL.md`'s "Plugin instruction and customer-enforcement
 * boundary".
 * Expiry publishes fail-open lifecycle state but never cancels the pending
 * decision. Installed customer code enforces that recommendation.
 */
export const DecisionTimeoutMsSchema = z
  .number()
  .int()
  .min(BOTBLOCKER_TIMEOUT_MIN_MS, `Timeout must be at least ${BOTBLOCKER_TIMEOUT_MIN_MS}ms`)
  .max(BOTBLOCKER_TIMEOUT_MAX_MS, `Timeout must be at most ${BOTBLOCKER_TIMEOUT_MAX_MS}ms`);

// ---------------------------------------------------------------------------
// Adapter / request context
// ---------------------------------------------------------------------------

/**
 * Low-privilege public site identifier — may appear in browser JavaScript;
 * it identifies the site for routing but authorizes nothing by itself (see
 * `docs/THREAT_MODEL.md`'s "API-key separation").
 */
export const SiteIdSchema = z.string().min(16).max(64);

/**
 * The opaque, project-scoped URL segment every server-to-server BotBlocker
 * runtime route requires in its path. The `bwh_<payload>.<hmac>` value is
 * immutable and self-validating: its signed payload binds format version,
 * random endpoint ID, project ID, and site ID. This lets the backend reject
 * malformed or forged paths before Valkey, MongoDB, request-body, or
 * credential work. It routes a request but does not replace the initial site
 * credential or a subsequent scoped visitor-session token.
 */
export const BotBlockerWebhookIdSchema = z
  .string()
  .min(120)
  .max(512)
  .regex(/^bwh_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

/**
 * The site credential is server-only and must never appear in browser
 * code, a public bundle, or a client-visible cookie (see
 * `docs/THREAT_MODEL.md`'s "API-key separation"). Defined here only so
 * every server-side adapter shares one validated type; no contract in this
 * file ever transmits it toward a browser-facing shape.
 */
export const SiteCredentialSchema = z.string().min(32);

/**
 * A client IP resolved only from a header/field the wrapper's own
 * deployment explicitly configured as trusted — never an arbitrary
 * client-supplied forwarded-IP header (see `docs/THREAT_MODEL.md`'s
 * "Trusted proxy / IP rules"). Optional because a misconfigured or
 * IP-less deployment must fail open rather than fabricate one.
 */
export const TrustedProxyIpSchema = z.union([z.ipv4(), z.ipv6()]);

export const httpMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;
export const HttpMethodSchema = z.enum(httpMethods);

/**
 * Route path only — query string and fragment must already be stripped by
 * the caller before this reaches any contract, per the sanitized-telemetry
 * table in `docs/THREAT_MODEL.md`'s BotBlocker section.
 */
export const SanitizedRoutePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^\/[^?#]*$/, "Must be a path only, with no query string or fragment");

/**
 * What a Gate Adapter (raw Node HTTP, Express, or Next.js wrapper) knows
 * about the inbound request before it asks RapidAuth for a decision.
 * Deliberately excludes headers, cookies, or body content — request
 * context is a decision input, not an evidence log.
 */
export const RequestContextSchema = z
  .object({
    siteId: SiteIdSchema,
    clientIp: TrustedProxyIpSchema.optional(),
    method: HttpMethodSchema,
    path: SanitizedRoutePathSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Browser evidence contract (sanitized fields only)
// ---------------------------------------------------------------------------

export const clickElementCategories = [
  "button",
  "link",
  "form_field",
  "form_submit",
  "navigation",
  "honeypot",
  "other",
] as const;
export const ClickElementCategorySchema = z.enum(clickElementCategories);

/**
 * One sanitized click observation with an optional document-normalized
 * position for project heatmaps — never the clicked text, a form value,
 * raw pixel coordinate, or arbitrary CSS selector. `powerOtpId` is
 * populated only when the clicked element carries the customer's own
 * explicit `data-powerotp-id` attribute.
 */
export const ClickObservationSchema = z
  .object({
    category: ClickElementCategorySchema,
    powerOtpId: z.string().min(1).max(200).optional(),
    position: z
      .object({
        xRatio: z.number().min(0).max(1),
        yRatio: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const POINTER_HEATMAP_GRID_SIZE = 32;
export const PointerHeatmapBinSchema = z
  .object({
    column: z.number().int().min(0).max(POINTER_HEATMAP_GRID_SIZE - 1),
    row: z.number().int().min(0).max(POINTER_HEATMAP_GRID_SIZE - 1),
    sampleCount: z.number().int().positive(),
    dwellMs: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Bounded session/page analytics for customer heatmaps and navigation
 * reporting. Pointer movement is aggregated into sparse fixed-grid bins in
 * the browser; no chronological coordinate trail is transmitted.
 * `pageId`/`pageName` come only from explicit customer-authored
 * data-powerotp-page-* attributes, never scraped page text or document.title.
 */
export const PageViewEvidenceSchema = z
  .object({
    pageId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    pageName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000),
    activeDurationMs: z.number().int().nonnegative().max(86_400_000),
    documentWidth: z.number().int().positive().max(1_000_000),
    documentHeight: z.number().int().positive().max(1_000_000),
    pointerHeatmap: z
      .object({
        gridSize: z.literal(POINTER_HEATMAP_GRID_SIZE),
        bins: z.array(PointerHeatmapBinSchema).max(
          POINTER_HEATMAP_GRID_SIZE * POINTER_HEATMAP_GRID_SIZE,
        ),
      })
      .strict()
      .superRefine((heatmap, context) => {
        const occupied = new Set<string>();
        for (const [index, bin] of heatmap.bins.entries()) {
          const key = `${bin.column}:${bin.row}`;
          if (occupied.has(key)) {
            context.addIssue({
              code: "custom",
              message: "Pointer heatmap bins must be unique",
              path: ["bins", index],
            });
          }
          occupied.add(key);
        }
      }),
    navigationTargetPath: SanitizedRoutePathSchema.optional(),
  })
  .strict()
  .refine(
    (pageView) => pageView.activeDurationMs <= pageView.durationMs,
    {
      message: "activeDurationMs cannot exceed durationMs",
      path: ["activeDurationMs"],
    },
  );

/**
 * Aggregate straight-line/"directness" signal between clicks, never a raw
 * coordinate trail. `averageDirectnessRatio` of 1 means every inter-click
 * path was a straight line; lower values indicate more natural, less
 * linear movement. `sampleCount` is how many inter-click segments the
 * average covers (0 if fewer than two clicks occurred in the interval).
 */
export const MouseDirectnessSchema = z
  .object({
    averageDirectnessRatio: z.number().min(0).max(1),
    sampleCount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Aggregate scroll behavior, never a raw scroll trail. `smoothnessScore`
 * is a normalized 0..1 aggregate (higher = smoother/more human-like);
 * `highSpeedEventCount` counts scroll events exceeding the sensor's own
 * high-speed threshold.
 */
export const ScrollBehaviorSchema = z
  .object({
    smoothnessScore: z.number().min(0).max(1),
    highSpeedEventCount: z.number().int().nonnegative(),
  })
  .strict();

export const HoneypotActivationSchema = z
  .object({
    honeypotId: z.string().min(1).max(200),
  })
  .strict();

export const BROWSER_ENVIRONMENT_EVIDENCE_VERSION = 1;
export const browserAutomationIndicators = [
  "webdriver",
  "untrusted_pointer",
  "untrusted_click",
  "untrusted_scroll",
] as const;
export const BrowserAutomationIndicatorSchema = z.enum(browserAutomationIndicators);

/**
 * Versioned, deliberately narrow environment metadata. The fixed indicator
 * enum prevents the sensor from reporting arbitrary browser properties,
 * user-agent strings, plugin/font inventories, or raw event details.
 */
export const BrowserEnvironmentEvidenceSchema = z
  .object({
    evidenceVersion: z.literal(BROWSER_ENVIRONMENT_EVIDENCE_VERSION),
    sensorVersion: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
    automationIndicators: z.array(BrowserAutomationIndicatorSchema).max(
      browserAutomationIndicators.length,
    ),
  })
  .strict();

/**
 * The complete sanitized evidence shape the runtime sensor is permitted to
 * report. Every field is checked against the "Allowed" column of
 * `docs/THREAT_MODEL.md`'s sanitized-telemetry table; `.strict()` makes the
 * type closed so a prohibited field (raw keystrokes, a coordinate trail,
 * page content, form values, arbitrary CSS selectors) is rejected at parse
 * time even if a caller's compiled JavaScript tries to smuggle one in —
 * see `botblocker.test.ts`'s prohibited-field tests.
 */
export const BrowserEvidenceSchema = z
  .object({
    routePath: SanitizedRoutePathSchema,
    clicks: z.array(ClickObservationSchema).max(200),
    mouseDirectness: MouseDirectnessSchema,
    scroll: ScrollBehaviorSchema,
    honeypotActivations: z.array(HoneypotActivationSchema).max(50),
    // Optional for protocol-v1 compatibility; the Phase 10 sensor always emits it.
    environment: BrowserEnvironmentEvidenceSchema.optional(),
    // Optional for protocol-v1 compatibility; corrected Phase 15 sensors emit it.
    pageView: PageViewEvidenceSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Report sequence / ordering
// ---------------------------------------------------------------------------

/**
 * Every report carries a monotonic per-session sequence number and its own
 * issuance time so the central API, adapter, and browser sensor can all
 * apply the "continuous decision revisions" rule from
 * `docs/THREAT_MODEL.md`: a report — and the decision it produces — with a
 * sequence number no newer than one already applied for that session must
 * be rejectable as stale, even if it arrives out of order over the
 * network.
 */
export const ReportSequenceSchema = z
  .object({
    gateSessionId: z.string().min(16),
    sequence: z.number().int().nonnegative(),
    issuedAt: z.number().int().positive(),
  })
  .strict();

/**
 * Pure staleness check shared by every consumer, so "reject a sequence
 * number no newer than one already applied" is defined exactly once (see
 * `docs/THREAT_MODEL.md`'s "Continuous decision revisions"). A sequence
 * from a different `gateSessionId` is not comparable and is never treated
 * as stale by this function alone.
 */
export function isStaleSequence(
  candidate: ReportSequence,
  lastApplied: ReportSequence | undefined,
): boolean {
  if (!lastApplied) return false;
  if (candidate.gateSessionId !== lastApplied.gateSessionId) return false;
  return candidate.sequence <= lastApplied.sequence;
}

// ---------------------------------------------------------------------------
// First / recurring / partial behavior report contracts
// ---------------------------------------------------------------------------

export const BEHAVIOR_REPORT_INITIAL_DELAY_MS = 5_000;
export const BEHAVIOR_REPORT_RECURRING_INTERVAL_MS = 30_000;

const BehaviorReportBaseSchema = z.object({
  protocolVersion: BotBlockerProtocolVersionSchema,
  sequence: ReportSequenceSchema,
  evidence: BrowserEvidenceSchema,
});

/** Sent once, `BEHAVIOR_REPORT_INITIAL_DELAY_MS` (5s) after load. */
export const InitialBehaviorReportSchema = BehaviorReportBaseSchema.extend({
  trigger: z.literal("initial"),
}).strict();

/** Sent every `BEHAVIOR_REPORT_RECURRING_INTERVAL_MS` (30s) thereafter. */
export const RecurringBehaviorReportSchema = BehaviorReportBaseSchema.extend({
  trigger: z.literal("recurring"),
}).strict();

export const partialBehaviorReportReasons = ["navigation", "hide", "exit"] as const;
export const PartialBehaviorReportReasonSchema = z.enum(partialBehaviorReportReasons);

/** Sent when an in-progress interval is cut short by route navigation,
 * page hide, or site exit — closes out that interval's evidence early
 * rather than discarding it. */
export const PartialBehaviorReportSchema = BehaviorReportBaseSchema.extend({
  trigger: z.literal("partial"),
  reason: PartialBehaviorReportReasonSchema,
}).strict();

export const BehaviorReportSchema = z.discriminatedUnion("trigger", [
  InitialBehaviorReportSchema,
  RecurringBehaviorReportSchema,
  PartialBehaviorReportSchema,
]);

// ---------------------------------------------------------------------------
// Decision outcome (Phase 2 — the only two values anywhere in the protocol)
// ---------------------------------------------------------------------------

/**
 * The only two visitor-facing decision values in the entire protocol (see
 * `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s Purpose/Product-invariants sections
 * and `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`'s "End goal"). There
 * is no third "deny", "block", or "monitor" outcome — a policy field like
 * `agent_access` eligibility or challenge cadence configures *how* a
 * decision is reached, it never becomes a third outcome value here.
 */
export const botBlockerDecisionOutcomes = ["allow", "otp"] as const;
export const BotBlockerDecisionOutcomeSchema = z.enum(botBlockerDecisionOutcomes);

// ---------------------------------------------------------------------------
// Decision revision envelope
// ---------------------------------------------------------------------------

/**
 * The envelope every decision revision is wrapped in. Phase 1 fixed the
 * versioning/sequence/audience/expiry wrapper only; Phase 2 fills in the
 * real `outcome` so every decision inherits the same staleness and
 * audience-binding guarantees from day one, mirroring the existing
 * `InteractionTokenClaimsSchema` pattern in
 * `backend/packages/api/src/interaction-tokens.ts` (audience + nonce + issued/expiry).
 * `.strict()` means a browser- or adapter-supplied field beyond this exact
 * shape (e.g. a client-computed score or a duplicate "decision" field) is
 * rejected at parse time, not silently ignored — see
 * `docs/THREAT_MODEL.md`'s "Iframe / postMessage authority" and
 * `botblocker.test.ts`'s envelope tests.
 */
export const DecisionRevisionEnvelopeSchema = z
  .object({
    protocolVersion: BotBlockerProtocolVersionSchema,
    siteId: SiteIdSchema,
    sequence: ReportSequenceSchema,
    outcome: BotBlockerDecisionOutcomeSchema,
    audience: z.string().min(1),
    nonce: z.string().min(16),
    expiresAt: z.number().int().positive(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Stable, typed error / unavailable-response contracts
// ---------------------------------------------------------------------------

export const botBlockerUnavailableReasons = [
  "not_implemented",
  "policy_unavailable",
  "dependency_unavailable",
  "rate_limited",
] as const;
export const BotBlockerUnavailableReasonSchema = z.enum(botBlockerUnavailableReasons);

/** Stable readiness response for an inactive project/site. Offline is a
 * fail-open lifecycle state, never a third decision outcome. */
export const BotBlockerOfflineResponseSchema = z
  .object({
    status: z.literal("offline"),
    reason: z.literal("site_inactive"),
    retryAfterMs: z.number().int().min(5_000).max(300_000),
  })
  .strict();

/**
 * The one typed shape every not-yet-backed or currently-failing BotBlocker
 * route returns instead of a fabricated decision, score, or approval — see
 * `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "This order does not permit fake
 * production behavior" rule and its API-surface section's "every route not
 * yet backed by a real implementation returns an explicit typed
 * `*_unavailable` response" requirement.
 */
export const BotBlockerUnavailableResponseSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: BotBlockerUnavailableReasonSchema,
    message: z.string().min(1).max(500).optional(),
    retryable: z.boolean(),
  })
  .strict();

export const botBlockerErrorCodes = [
  "invalid_signature",
  "expired",
  "audience_mismatch",
  "stale_sequence",
  "invalid_timeout",
  "invalid_evidence",
  "unknown_site",
  "authentication_required",
  "invalid_request",
  "replay_detected",
  "idempotency_key_conflict",
  /** Phase 2: a policy release version no newer than the currently active
   * one — see `botblocker-policy.ts`'s `isPolicyVersionRegression`. */
  "policy_version_regression",
  /** Phase 2: a challenge lifecycle transition not permitted from its
   * current state — see `botblocker-challenge.ts`'s
   * `isValidBotBlockerChallengeTransition`. */
  "invalid_challenge_transition",
] as const;
export const BotBlockerErrorCodeSchema = z.enum(botBlockerErrorCodes);

/**
 * Distinct from `BotBlockerUnavailableResponseSchema`: this is a rejected
 * *request* (caller error), not an unfinished or degraded dependency.
 * `stale_sequence` is the specific code for a report/decision rejected
 * under the "continuous decision revisions" rule above.
 */
export const BotBlockerErrorResponseSchema = z
  .object({
    status: z.literal("error"),
    code: BotBlockerErrorCodeSchema,
    message: z.string().min(1).max(500).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BotBlockerProtocolVersion = z.infer<typeof BotBlockerProtocolVersionSchema>;
export type BotBlockerContractVersion = z.infer<typeof BotBlockerContractVersionSchema>;
export type DecisionTimeoutMs = z.infer<typeof DecisionTimeoutMsSchema>;
export type SiteId = z.infer<typeof SiteIdSchema>;
export type BotBlockerWebhookId = z.infer<typeof BotBlockerWebhookIdSchema>;
export type SiteCredential = z.infer<typeof SiteCredentialSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type SanitizedRoutePath = z.infer<typeof SanitizedRoutePathSchema>;
export type RequestContext = z.infer<typeof RequestContextSchema>;
export type ClickElementCategory = z.infer<typeof ClickElementCategorySchema>;
export type ClickObservation = z.infer<typeof ClickObservationSchema>;
export type PointerHeatmapBin = z.infer<typeof PointerHeatmapBinSchema>;
export type PageViewEvidence = z.infer<typeof PageViewEvidenceSchema>;
export type MouseDirectness = z.infer<typeof MouseDirectnessSchema>;
export type ScrollBehavior = z.infer<typeof ScrollBehaviorSchema>;
export type HoneypotActivation = z.infer<typeof HoneypotActivationSchema>;
export type BrowserAutomationIndicator = z.infer<typeof BrowserAutomationIndicatorSchema>;
export type BrowserEnvironmentEvidence = z.infer<typeof BrowserEnvironmentEvidenceSchema>;
export type BrowserEvidence = z.infer<typeof BrowserEvidenceSchema>;
export type ReportSequence = z.infer<typeof ReportSequenceSchema>;
export type InitialBehaviorReport = z.infer<typeof InitialBehaviorReportSchema>;
export type RecurringBehaviorReport = z.infer<typeof RecurringBehaviorReportSchema>;
export type PartialBehaviorReportReason = z.infer<typeof PartialBehaviorReportReasonSchema>;
export type PartialBehaviorReport = z.infer<typeof PartialBehaviorReportSchema>;
export type BehaviorReport = z.infer<typeof BehaviorReportSchema>;
export type BotBlockerDecisionOutcome = z.infer<typeof BotBlockerDecisionOutcomeSchema>;
export type DecisionRevisionEnvelope = z.infer<typeof DecisionRevisionEnvelopeSchema>;
export type BotBlockerUnavailableReason = z.infer<typeof BotBlockerUnavailableReasonSchema>;
export type BotBlockerUnavailableResponse = z.infer<typeof BotBlockerUnavailableResponseSchema>;
export type BotBlockerOfflineResponse = z.infer<typeof BotBlockerOfflineResponseSchema>;
export type BotBlockerErrorCode = z.infer<typeof BotBlockerErrorCodeSchema>;
export type BotBlockerErrorResponse = z.infer<typeof BotBlockerErrorResponseSchema>;
