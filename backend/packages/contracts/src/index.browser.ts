/**
 * Browser-safe entry point for `@powerotp/contracts`.
 *
 * Any module reachable from a customer-facing browser bundle — the BotBlocker
 * widget sensor/controller (`@powerotp/gate-core`), its browser coordinator
 * (`@powerotp/gate-node/browser`), and any framework client component that
 * imports either — must import from `@powerotp/contracts/browser`, never the
 * root `.` export. The root export's `index.ts` barrel re-exports every
 * contracts file, including backend-only Mongo persistence document schemas
 * and admin control-plane contracts; bundlers have repeatedly failed to
 * fully tree-shake unused named exports out of that single large barrel
 * (`export *` re-export chains defeat per-export dead-code elimination in
 * both webpack/Turbopack), so anything reachable from the root export can
 * end up textually present in a shipped client bundle regardless of what
 * that bundle actually references. See the dated 2026-08-18 entry in
 * `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md` for the incident that first
 * surfaced this and the resolution this file is part of.
 *
 * This entry point intentionally uses explicit symbol exports. Some source
 * files mix browser protocol contracts with server-only contracts (for
 * example `botblocker.ts` also defines `SiteCredentialSchema`), so replacing
 * the root barrel with another `export *` barrel would still expose an
 * unnecessarily broad public API and keep relying on tree-shaking.
 *
 * Before adding a new export here, confirm the source file contains no
 * MongoDB document schema, HMAC secret, admin/control-plane contract, or
 * other server-only structure — and add it to
 * `backend/packages/contracts/src/index.browser.test.ts`'s required/forbidden
 * export lists.
 */
export {
  BEHAVIOR_REPORT_INITIAL_DELAY_MS,
  BEHAVIOR_REPORT_RECURRING_INTERVAL_MS,
  BehaviorReportSchema,
  BOTBLOCKER_PROTOCOL_VERSION,
  BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
  BrowserEnvironmentEvidenceSchema,
  BrowserEvidenceSchema,
  DecisionRevisionEnvelopeSchema,
  DecisionTimeoutMsSchema,
  POINTER_HEATMAP_GRID_SIZE,
  browserAutomationIndicators,
  isStaleSequence,
  type BehaviorReport,
  type BotBlockerDecisionOutcome,
  type BrowserAutomationIndicator,
  type BrowserEvidence,
  type ClickObservation,
  type DecisionRevisionEnvelope,
  type PartialBehaviorReportReason,
  type ReportSequence,
} from "./botblocker.js";
export {
  GateRecommendationSnapshotSchema,
  InitialBrowserProofEvidenceSchema,
  OtpLaunchMetadataSchema,
  type GateRecommendationSnapshot,
  type InitialBrowserProofEvidence,
} from "./botblocker-browser.js";
export {
  FINGERPRINT_COLLECTOR_VERSION,
  FINGERPRINT_VECTOR_VERSION,
  FingerprintVectorSchema,
  type FingerprintUnavailableStatus,
  type FingerprintVector,
} from "./fingerprint.js";
export {
  FingerprintComponentValueSchemas,
  fingerprintComponentNames,
} from "./fingerprint-components.js";
