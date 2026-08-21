import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hostedAuthApprovedCertificationWording,
  hostedAuthConsentEvidenceRequirements,
  hostedAuthConsentPurposes,
  hostedAuthDiditProductionGates,
  hostedAuthProhibitedClaims,
  HostedAuthConsentEvidenceRequirementsSchema,
  HostedAuthConsentPurposeSetSchema,
  HostedAuthDiditProductionGateSetSchema,
  HostedAuthProhibitedClaimSetSchema,
} from "./hosted-auth-consent-and-vendor-gates.js";

describe("hosted-auth consent purposes", () => {
  it("locks separate capability purposes and retained-face consent", () => {
    assert.equal(
      HostedAuthConsentPurposeSetSchema.safeParse(hostedAuthConsentPurposes)
        .success,
      true,
    );
    assert.equal(
      hostedAuthConsentPurposes.find(
        (entry) =>
          entry.purpose ===
          "fresh_biometric_authentication_with_retained_face",
      )?.retainedFace,
      true,
    );
  });

  it("rejects omitted, reordered, bundled, or reclassified purposes", () => {
    const bundledConsent = hostedAuthConsentPurposes.map((entry, index) =>
      index === 2 ? { ...entry, separateAffirmativeDecision: false } : entry,
    );
    const changedReuse = hostedAuthConsentPurposes.map((entry, index) =>
      index === 4 ? { ...entry, reusableAcrossProjects: true } : entry,
    );

    for (const invalid of [
      hostedAuthConsentPurposes.slice(1),
      [hostedAuthConsentPurposes[1], hostedAuthConsentPurposes[0]],
      bundledConsent,
      changedReuse,
    ]) {
      assert.equal(
        HostedAuthConsentPurposeSetSchema.safeParse(invalid).success,
        false,
      );
    }
  });
});

describe("hosted-auth consent evidence", () => {
  it("requires exact evidence and consent before collection", () => {
    assert.equal(
      HostedAuthConsentEvidenceRequirementsSchema.safeParse(
        hostedAuthConsentEvidenceRequirements,
      ).success,
      true,
    );
    assert.equal(
      HostedAuthConsentEvidenceRequirementsSchema.safeParse({
        ...hostedAuthConsentEvidenceRequirements,
        captureBeforeConsentAllowed: true,
      }).success,
      false,
    );
    assert.equal(
      HostedAuthConsentEvidenceRequirementsSchema.safeParse({
        ...hostedAuthConsentEvidenceRequirements,
        exactTextVersion: false,
      }).success,
      false,
    );
  });
});

describe("hosted-auth Didit production gates", () => {
  it("rejects incomplete, reordered, or invented gate sets", () => {
    assert.equal(
      HostedAuthDiditProductionGateSetSchema.safeParse(
        hostedAuthDiditProductionGates,
      ).success,
      true,
    );
    assert.equal(
      HostedAuthDiditProductionGateSetSchema.safeParse(
        hostedAuthDiditProductionGates.slice(1),
      ).success,
      false,
    );
    assert.equal(
      HostedAuthDiditProductionGateSetSchema.safeParse([
        ...hostedAuthDiditProductionGates.slice(0, -1),
        "vendor_marketing_claim_reviewed",
      ]).success,
      false,
    );
  });
});

describe("hosted-auth certification and prohibited claims", () => {
  it("locks the only approved certification wording", () => {
    assert.deepEqual(hostedAuthApprovedCertificationWording, [
      "designed to align with ISO/IEC 27001 controls",
      "uses infrastructure providers whose applicable services are certified",
    ]);
  });

  it("locks the complete prohibited-claim set", () => {
    assert.equal(
      HostedAuthProhibitedClaimSetSchema.safeParse(hostedAuthProhibitedClaims)
        .success,
      true,
    );
    assert.equal(
      HostedAuthProhibitedClaimSetSchema.safeParse(
        hostedAuthProhibitedClaims.slice(1),
      ).success,
      false,
    );
    assert.equal(
      HostedAuthProhibitedClaimSetSchema.safeParse([
        ...hostedAuthProhibitedClaims.slice(0, -1),
        "vendor_certification_is_ours",
      ]).success,
      false,
    );
  });
});
