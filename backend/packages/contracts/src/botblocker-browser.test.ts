import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EmptyOtpOpenRequestSchema,
  GateRecommendationSnapshotSchema,
  InitialBrowserProofEvidenceSchema,
  OtpLaunchMetadataSchema,
  type GateRecommendationSnapshot,
  type InitialBrowserProofEvidence,
} from "./botblocker-browser.js";
import { BOTBLOCKER_PROTOCOL_VERSION } from "./botblocker.js";

const sequence = {
  gateSessionId: "gate_session_123456789",
  sequence: 2,
  issuedAt: 1_786_000_000_000,
};

function initialEvidence(): InitialBrowserProofEvidence {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    proofs: {},
    evidence: {
      routePath: "/account",
      clicks: [],
      mouseDirectness: { averageDirectnessRatio: 0, sampleCount: 0 },
      scroll: { smoothnessScore: 0, highSpeedEventCount: 0 },
      honeypotActivations: [],
      environment: {
        evidenceVersion: 1,
        sensorVersion: "sensor-v1",
        automationIndicators: [],
      },
    },
  };
}

describe("initial browser proof and evidence", () => {
  it("accepts only bounded evidence and candidate proofs", () => {
    assert.equal(InitialBrowserProofEvidenceSchema.safeParse(initialEvidence()).success, true);

    const rawFingerprint = {
      ...initialEvidence(),
      evidence: { ...initialEvidence().evidence, fingerprintHash: "browser-supplied" },
    };
    assert.equal(InitialBrowserProofEvidenceSchema.safeParse(rawFingerprint).success, false);

    const fabricatedApproval = {
      ...initialEvidence(),
      proofs: { passport: { verified: true } },
    };
    assert.equal(InitialBrowserProofEvidenceSchema.safeParse(fabricatedApproval).success, false);
  });

  it("does not accept unsigned clearance as an initial proof", () => {
    const value = {
      ...initialEvidence(),
      proofs: {
        clearance: {
          signatureStatus: "unsigned",
          siteId: "site_0123456789abcdef",
          gateSessionId: sequence.gateSessionId,
          audience: "https://customer.example",
          nonce: "nonce_0123456789abcdef",
          issuedAt: sequence.issuedAt,
          expiresAt: sequence.issuedAt + 60_000,
        },
      },
    };
    assert.equal(InitialBrowserProofEvidenceSchema.safeParse(value).success, false);
  });
});

describe("public recommendation snapshots", () => {
  it("distinguishes checking, fail-open, verified allow, OTP, and verification", () => {
    const snapshots: GateRecommendationSnapshot[] = [
      {
        lifecycle: "checking",
        recommendation: "restricted",
        decisionPending: true,
        otpOpen: false,
      },
      {
        lifecycle: "fail_open",
        recommendation: "full_access",
        decisionPending: true,
        otpOpen: false,
      },
      {
        lifecycle: "observing",
        recommendation: "full_access",
        decision: "allow",
        decisionPending: false,
        otpOpen: false,
        lastApplied: sequence,
      },
      {
        lifecycle: "otp_required",
        recommendation: "otp_required",
        decision: "otp",
        decisionPending: false,
        otpOpen: true,
        lastApplied: sequence,
      },
      {
        lifecycle: "verified",
        recommendation: "full_access",
        decision: "otp",
        decisionPending: false,
        otpOpen: false,
        lastApplied: sequence,
      },
    ];
    assert.ok(snapshots.every((snapshot) =>
      GateRecommendationSnapshotSchema.safeParse(snapshot).success
    ));
  });

  it("rejects fabricated decisions and contradictory recommendations", () => {
    assert.equal(GateRecommendationSnapshotSchema.safeParse({
      lifecycle: "fail_open",
      recommendation: "full_access",
      decision: "allow",
      decisionPending: false,
      otpOpen: false,
    }).success, false);
    assert.equal(GateRecommendationSnapshotSchema.safeParse({
      lifecycle: "otp_required",
      recommendation: "full_access",
      decision: "otp",
      decisionPending: false,
      otpOpen: false,
    }).success, false);
  });
});

describe("OTP opener contracts", () => {
  it("accepts no request body or caller-selected OTP options", () => {
    assert.equal(EmptyOtpOpenRequestSchema.safeParse(undefined).success, true);
    assert.equal(EmptyOtpOpenRequestSchema.safeParse({}).success, false);
    assert.equal(EmptyOtpOpenRequestSchema.safeParse({ method: "sms" }).success, false);
  });

  it("accepts only credential-free approved HTTPS metadata", () => {
    const valid = {
      challengeId: "challenge_123456789",
      challengeUrl: "https://verify.powerotp.com/challenge/challenge_123456789",
      challengeOrigin: "https://verify.powerotp.com",
    };
    assert.equal(OtpLaunchMetadataSchema.safeParse(valid).success, true);
    assert.equal(OtpLaunchMetadataSchema.safeParse({
      ...valid,
      challengeUrl: "https://user:secret@verify.powerotp.com/challenge/1",
    }).success, false);
    assert.equal(OtpLaunchMetadataSchema.safeParse({
      ...valid,
      method: "voice",
    }).success, false);
  });
});
