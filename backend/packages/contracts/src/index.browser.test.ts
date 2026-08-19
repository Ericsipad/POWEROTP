import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as backend from "./index.js";
import * as browserSafe from "./index.browser.js";

/**
 * Representative server-only names that must never be reachable from
 * `@powerotp/contracts/browser` (see that file's doc comment). This is a
 * name-surface guard; the actual built-bundle assertion lives in
 * `libraries/gate-next/src/react.test.tsx`.
 */
const forbiddenNames = [
  // Mixed botblocker.ts module: server adapter/runtime boundaries
  "SiteCredentialSchema",
  "BotBlockerWebhookIdSchema",
  "RequestContextSchema",
  "TrustedProxyIpSchema",
  "CanonicalReportRequestSchema",
  // botblocker-persistence.ts
  "GateSessionRecordSchema",
  "UserIntelligenceRecordSchema",
  "FingerprintDataRecordSchema",
  "DurableRiskEventRecordSchema",
  "BotBlockerChallengeRecordSchema",
  // botblocker-policy-persistence.ts
  "PolicyReleaseRecordSchema",
  // botblocker-api-control.ts (operator/admin control-plane)
  "OperatorIpBlacklistMutationSchema",
  "OperatorAsnClassificationMutationSchema",
  "CustomerVisitorSchema",
  // botblocker-site.ts
  "BotBlockerSiteConfigurationSchema",
  // auth.ts / billing.ts / projects.ts (customer dashboard, not the widget)
  "CustomerRegistrationSchema",
  "UpdateProjectSchema",
] as const;

describe("@powerotp/contracts/browser", () => {
  it("never re-exports a server-only persistence, admin, or adapter contract", () => {
    for (const name of forbiddenNames) {
      assert.ok(
        name in backend,
        `${name} is expected on the root export — update this guard's fixture`,
      );
      assert.equal(
        name in browserSafe,
        false,
        `${name} leaked into @powerotp/contracts/browser`,
      );
    }
  });

  it("has an exact, closed runtime export surface for the widget", () => {
    assert.deepEqual(Object.keys(browserSafe).sort(), [
      "BEHAVIOR_REPORT_INITIAL_DELAY_MS",
      "BEHAVIOR_REPORT_RECURRING_INTERVAL_MS",
      "BOTBLOCKER_PROTOCOL_VERSION",
      "BROWSER_ENVIRONMENT_EVIDENCE_VERSION",
      "BehaviorReportSchema",
      "BrowserEnvironmentEvidenceSchema",
      "BrowserEvidenceSchema",
      "DecisionRevisionEnvelopeSchema",
      "DecisionTimeoutMsSchema",
      "FINGERPRINT_COLLECTOR_VERSION",
      "FINGERPRINT_VECTOR_VERSION",
      "FingerprintComponentValueSchemas",
      "FingerprintVectorSchema",
      "GateRecommendationSnapshotSchema",
      "InitialBrowserProofEvidenceSchema",
      "OtpLaunchMetadataSchema",
      "POINTER_HEATMAP_GRID_SIZE",
      "browserAutomationIndicators",
      "fingerprintComponentNames",
      "isStaleSequence",
    ].sort());
  });
});
