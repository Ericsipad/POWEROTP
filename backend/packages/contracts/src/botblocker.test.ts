import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOTBLOCKER_TIMEOUT_MAX_MS,
  BOTBLOCKER_TIMEOUT_MIN_MS,
  BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
  BehaviorReportSchema,
  type BrowserEnvironmentEvidence,
  type BrowserEvidence,
  BrowserEvidenceSchema,
  type ClickObservation,
  BotBlockerDecisionOutcomeSchema,
  type DecisionRevisionEnvelope,
  DecisionRevisionEnvelopeSchema,
  DecisionTimeoutMsSchema,
  BotBlockerErrorResponseSchema,
  BotBlockerUnavailableResponseSchema,
  RequestContextSchema,
  type ReportSequence,
  isStaleSequence,
} from "./botblocker.js";

describe("DecisionTimeoutMsSchema boundaries", () => {
  it(`accepts exactly the minimum (${BOTBLOCKER_TIMEOUT_MIN_MS}ms)`, () => {
    assert.equal(DecisionTimeoutMsSchema.safeParse(BOTBLOCKER_TIMEOUT_MIN_MS).success, true);
  });

  it(`rejects one below the minimum (${BOTBLOCKER_TIMEOUT_MIN_MS - 1}ms)`, () => {
    assert.equal(
      DecisionTimeoutMsSchema.safeParse(BOTBLOCKER_TIMEOUT_MIN_MS - 1).success,
      false,
    );
  });

  it(`accepts exactly the maximum (${BOTBLOCKER_TIMEOUT_MAX_MS}ms)`, () => {
    assert.equal(DecisionTimeoutMsSchema.safeParse(BOTBLOCKER_TIMEOUT_MAX_MS).success, true);
  });

  it(`rejects one above the maximum (${BOTBLOCKER_TIMEOUT_MAX_MS + 1}ms)`, () => {
    assert.equal(
      DecisionTimeoutMsSchema.safeParse(BOTBLOCKER_TIMEOUT_MAX_MS + 1).success,
      false,
    );
  });

  it("rejects a non-integer timeout", () => {
    assert.equal(DecisionTimeoutMsSchema.safeParse(200.5).success, false);
  });
});

function validEvidence(): BrowserEvidence {
  return {
    routePath: "/checkout",
    clicks: [{ category: "form_submit", powerOtpId: "checkout-submit" }],
    mouseDirectness: { averageDirectnessRatio: 0.72, sampleCount: 4 },
    scroll: { smoothnessScore: 0.9, highSpeedEventCount: 0 },
    honeypotActivations: [],
  };
}

describe("BrowserEvidenceSchema", () => {
  it("accepts a fully sanitized evidence report", () => {
    assert.equal(BrowserEvidenceSchema.safeParse(validEvidence()).success, true);
  });

  it("accepts bounded page timing, normalized clicks, and aggregate pointer heatmaps", () => {
    const result = BrowserEvidenceSchema.safeParse({
      ...validEvidence(),
      clicks: [{
        category: "form_submit",
        powerOtpId: "checkout-submit",
        position: { xRatio: 0.25, yRatio: 0.75 },
      }],
      pageView: {
        pageId: "checkout",
        pageName: "Checkout",
        durationMs: 5_000,
        activeDurationMs: 4_800,
        documentWidth: 1_440,
        documentHeight: 3_200,
        pointerHeatmap: {
          gridSize: 32,
          bins: [{ column: 8, row: 24, sampleCount: 10, dwellMs: 900 }],
        },
        navigationTargetPath: "/confirmation",
      },
    });
    assert.equal(result.success, true);
  });

  it("rejects raw or contradictory heatmap analytics", () => {
    const pageView = {
      durationMs: 1_000,
      activeDurationMs: 1_001,
      documentWidth: 100,
      documentHeight: 100,
      pointerHeatmap: {
        gridSize: 32,
        bins: [
          { column: 1, row: 1, sampleCount: 1, dwellMs: 10 },
          { column: 1, row: 1, sampleCount: 1, dwellMs: 10 },
        ],
      },
    };
    assert.equal(
      BrowserEvidenceSchema.safeParse({
        ...validEvidence(),
        pageView,
      }).success,
      false,
    );
    assert.equal(
      BrowserEvidenceSchema.safeParse({
        ...validEvidence(),
        clicks: [{
          category: "button",
          position: { xRatio: 12, yRatio: 40 },
        }],
      }).success,
      false,
    );
  });

  it("rejects a route path carrying a query string", () => {
    const result = BrowserEvidenceSchema.safeParse({
      ...validEvidence(),
      routePath: "/checkout?ref=abc",
    });
    assert.equal(result.success, false);
  });

  it("rejects a route path carrying a fragment", () => {
    const result = BrowserEvidenceSchema.safeParse({
      ...validEvidence(),
      routePath: "/checkout#summary",
    });
    assert.equal(result.success, false);
  });

  it("accepts only versioned, approved automation indicators", () => {
    assert.equal(
      BrowserEvidenceSchema.safeParse({
        ...validEvidence(),
        environment: {
          evidenceVersion: BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
          sensorVersion: "sensor-1.0.0",
          automationIndicators: ["webdriver", "untrusted_click"],
        },
      }).success,
      true,
    );
    assert.equal(
      BrowserEvidenceSchema.safeParse({
        ...validEvidence(),
        environment: {
          evidenceVersion: 2,
          sensorVersion: "sensor-1.0.0",
          automationIndicators: ["headless_guess"],
        },
      }).success,
      false,
    );
  });

  describe("prohibited-field exclusion", () => {
    it("rejects raw keystrokes at runtime (and cannot be assigned at compile time)", () => {
      const valid = validEvidence();

      // @ts-expect-error -- BrowserEvidence must never be able to carry raw keystrokes.
      const withKeystrokes: BrowserEvidence = { ...valid, keystrokes: ["a", "b", "c"] };

      assert.equal(BrowserEvidenceSchema.safeParse(withKeystrokes).success, false);
    });

    it("rejects a raw mouse coordinate trail at runtime (and cannot be assigned at compile time)", () => {
      const valid = validEvidence();

      // @ts-expect-error -- BrowserEvidence must never be able to carry a raw coordinate trail.
      const withMouseTrail: BrowserEvidence = { ...valid, mouseTrail: [{ x: 12, y: 40 }, { x: 13, y: 41 }] };

      assert.equal(BrowserEvidenceSchema.safeParse(withMouseTrail).success, false);
    });

    it("rejects raw page content at runtime (and cannot be assigned at compile time)", () => {
      const valid = validEvidence();

      // @ts-expect-error -- BrowserEvidence must never be able to carry raw page content.
      const withPageContent: BrowserEvidence = { ...valid, pageContent: "<html><body>secret form values here</body></html>" };

      assert.equal(BrowserEvidenceSchema.safeParse(withPageContent).success, false);
    });

    it("rejects a clicked element's raw text at runtime (and cannot be assigned at compile time)", () => {
      const valid = validEvidence();
      const firstClick = valid.clicks[0]!;

      // @ts-expect-error -- a click observation must never carry the clicked element's text.
      const withClickedText: ClickObservation = { ...firstClick, clickedText: "Submit order" };

      assert.equal(
        BrowserEvidenceSchema.safeParse({ ...valid, clicks: [withClickedText] }).success,
        false,
      );
    });

    it("rejects raw browser fingerprint fields in environment evidence", () => {
      const environment: BrowserEnvironmentEvidence = {
        evidenceVersion: BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
        sensorVersion: "sensor-1.0.0",
        automationIndicators: [],
        // @ts-expect-error -- environment evidence cannot carry a raw user-agent string.
        userAgent: "raw browser fingerprint",
      };

      assert.equal(
        BrowserEvidenceSchema.safeParse({ ...validEvidence(), environment }).success,
        false,
      );
    });
  });
});

describe("BehaviorReportSchema", () => {
  const sequence: ReportSequence = {
    gateSessionId: "gate_session_0123456789",
    sequence: 0,
    issuedAt: Date.now(),
  };

  it("accepts an initial report", () => {
    assert.equal(
      BehaviorReportSchema.safeParse({
        protocolVersion: 1,
        trigger: "initial",
        sequence,
        evidence: validEvidence(),
      }).success,
      true,
    );
  });

  it("accepts a recurring report", () => {
    assert.equal(
      BehaviorReportSchema.safeParse({
        protocolVersion: 1,
        trigger: "recurring",
        sequence: { ...sequence, sequence: 1 },
        evidence: validEvidence(),
      }).success,
      true,
    );
  });

  it("requires a reason on a partial report", () => {
    assert.equal(
      BehaviorReportSchema.safeParse({
        protocolVersion: 1,
        trigger: "partial",
        sequence: { ...sequence, sequence: 2 },
        evidence: validEvidence(),
      }).success,
      false,
    );
  });

  it("accepts a partial report with a valid reason", () => {
    assert.equal(
      BehaviorReportSchema.safeParse({
        protocolVersion: 1,
        trigger: "partial",
        reason: "navigation",
        sequence: { ...sequence, sequence: 2 },
        evidence: validEvidence(),
      }).success,
      true,
    );
  });

  it("rejects an unrecognized trigger", () => {
    assert.equal(
      BehaviorReportSchema.safeParse({
        protocolVersion: 1,
        trigger: "unexpected",
        sequence,
        evidence: validEvidence(),
      }).success,
      false,
    );
  });
});

describe("isStaleSequence", () => {
  const lastApplied: ReportSequence = {
    gateSessionId: "gate_session_0123456789",
    sequence: 5,
    issuedAt: Date.now(),
  };

  it("treats a strictly newer sequence as not stale", () => {
    assert.equal(isStaleSequence({ ...lastApplied, sequence: 6 }, lastApplied), false);
  });

  it("treats an equal sequence (replay) as stale", () => {
    assert.equal(isStaleSequence({ ...lastApplied, sequence: 5 }, lastApplied), true);
  });

  it("treats an older sequence as stale", () => {
    assert.equal(isStaleSequence({ ...lastApplied, sequence: 4 }, lastApplied), true);
  });

  it("treats nothing as previously applied as never stale", () => {
    assert.equal(isStaleSequence(lastApplied, undefined), false);
  });

  it("does not compare sequences across different gate sessions", () => {
    assert.equal(
      isStaleSequence({ gateSessionId: "gate_session_other_0000", sequence: 0, issuedAt: Date.now() }, lastApplied),
      false,
    );
  });
});

describe("BotBlockerDecisionOutcomeSchema", () => {
  it("accepts 'allow'", () => {
    assert.equal(BotBlockerDecisionOutcomeSchema.safeParse("allow").success, true);
  });

  it("accepts 'otp'", () => {
    assert.equal(BotBlockerDecisionOutcomeSchema.safeParse("otp").success, true);
  });

  for (const thirdOutcome of ["deny", "block", "monitor", "allowed", ""]) {
    it(`rejects the non-existent third outcome '${thirdOutcome}'`, () => {
      assert.equal(BotBlockerDecisionOutcomeSchema.safeParse(thirdOutcome).success, false);
    });
  }
});

describe("DecisionRevisionEnvelopeSchema", () => {
  function validEnvelope(): DecisionRevisionEnvelope {
    return {
      protocolVersion: 1,
      siteId: "site_0123456789abcdef",
      sequence: { gateSessionId: "gate_session_0123456789", sequence: 0, issuedAt: Date.now() },
      outcome: "allow",
      audience: "https://customer.example",
      nonce: "nonce_0123456789abcdef",
      expiresAt: Date.now() + 60_000,
    };
  }

  it("accepts a fully populated envelope with an 'allow' outcome", () => {
    assert.equal(DecisionRevisionEnvelopeSchema.safeParse(validEnvelope()).success, true);
  });

  it("accepts a fully populated envelope with an 'otp' outcome", () => {
    assert.equal(
      DecisionRevisionEnvelopeSchema.safeParse({ ...validEnvelope(), outcome: "otp" }).success,
      true,
    );
  });

  it("rejects an envelope missing the outcome field", () => {
    const { outcome, ...withoutOutcome } = validEnvelope();
    assert.equal(DecisionRevisionEnvelopeSchema.safeParse(withoutOutcome).success, false);
  });

  it("rejects an envelope with a fabricated third outcome value", () => {
    const result = DecisionRevisionEnvelopeSchema.safeParse({
      ...validEnvelope(),
      outcome: "deny",
    });
    assert.equal(result.success, false);
  });

  it("rejects a browser-supplied score alongside a valid outcome (and cannot be assigned at compile time)", () => {
    const valid = validEnvelope();

    // @ts-expect-error -- a decision envelope must never carry a client-computed score.
    const withScore: DecisionRevisionEnvelope = { ...valid, score: 87 };

    assert.equal(DecisionRevisionEnvelopeSchema.safeParse(withScore).success, false);
  });
});

describe("RequestContextSchema", () => {
  it("accepts a request context without a client IP", () => {
    assert.equal(
      RequestContextSchema.safeParse({
        siteId: "site_0123456789abcdef",
        method: "GET",
        path: "/dashboard",
      }).success,
      true,
    );
  });

  it("accepts a trusted-proxy-derived IPv4 address", () => {
    assert.equal(
      RequestContextSchema.safeParse({
        siteId: "site_0123456789abcdef",
        clientIp: "203.0.113.10",
        method: "POST",
        path: "/checkout",
      }).success,
      true,
    );
  });

  it("rejects a path carrying a query string", () => {
    assert.equal(
      RequestContextSchema.safeParse({
        siteId: "site_0123456789abcdef",
        method: "GET",
        path: "/dashboard?tab=billing",
      }).success,
      false,
    );
  });
});

describe("BotBlockerUnavailableResponseSchema", () => {
  it("accepts a typed unavailable response for a not-yet-built route", () => {
    assert.equal(
      BotBlockerUnavailableResponseSchema.safeParse({
        status: "unavailable",
        reason: "not_implemented",
        retryable: false,
      }).success,
      true,
    );
  });
});

describe("BotBlockerErrorResponseSchema", () => {
  it("accepts a stale_sequence error", () => {
    assert.equal(
      BotBlockerErrorResponseSchema.safeParse({
        status: "error",
        code: "stale_sequence",
      }).success,
      true,
    );
  });

  it("rejects an unrecognized error code", () => {
    assert.equal(
      BotBlockerErrorResponseSchema.safeParse({
        status: "error",
        code: "made_up_code",
      }).success,
      false,
    );
  });
});
