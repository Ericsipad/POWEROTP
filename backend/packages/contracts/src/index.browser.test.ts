import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as backend from "./index.js";
import * as browserSafe from "./index.browser.js";

/**
 * Names unique to files that must never be reachable from
 * `@powerotp/contracts/browser` (see that file's doc comment): backend-only
 * MongoDB persistence document schemas and admin/control-plane contracts.
 * This is a name-surface guard, not a bundle-content guard — the actual
 * built-bundle assertion lives in `libraries/gate-next/src/react.test.tsx`,
 * which scans the real compiled Next.js client chunks.
 */
const backendOnlyNames = [
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
  it("never re-exports a name unique to a backend-only persistence or admin file", () => {
    for (const name of backendOnlyNames) {
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

  it("still exports the browser-reachable widget contracts the sensor/coordinator need", () => {
    for (
      const name of [
        "BOTBLOCKER_PROTOCOL_VERSION",
        "BehaviorReportSchema",
        "BrowserEvidenceSchema",
        "DecisionRevisionEnvelopeSchema",
        "InitialBrowserProofEvidenceSchema",
        "GateRecommendationSnapshotSchema",
        "OtpLaunchMetadataSchema",
        "SignedSiteClearanceSchema",
        "PassportAssertionSchema",
        "PaidTokenPassAssertionSchema",
        "canonicalizeBotBlockerArtifact",
        "FingerprintVectorSchema",
        "fingerprintComponentNames",
      ]
    ) {
      assert.ok(name in browserSafe, `${name} is missing from the browser export`);
    }
  });
});
