import type {
  BrowserEvidence,
  CanonicalReportRequest,
  RiskEventScoreStatus,
  RiskEventScoreableField,
  RiskEventScoringConfiguration,
} from "@powerotp/contracts";
import type { ClientSession } from "mongodb";

import {
  evaluateScoringFieldExpression,
  evaluateScoringFinalExpression,
  isScoringResult,
  safeScoringNumber,
} from "./botblocker-profile-scoring.js";
import type {
  BotBlockerRiskEventScoringPersistence,
  RiskEventScoringConfigurationDocument,
} from "./botblocker-risk-event-scoring-persistence.js";

type ConfigurationStore = Pick<
  BotBlockerRiskEventScoringPersistence,
  "getConfiguration"
>;

export function calculateRiskEventScore(
  report: CanonicalReportRequest,
  stored: RiskEventScoringConfigurationDocument | null,
): RiskEventScoreStatus {
  if (!stored) {
    return { status: "unavailable", reason: "scoring_unconfigured" };
  }
  const aggregate = aggregateFieldScores(report, stored.configuration);
  if (aggregate.presentFieldCount === 0) {
    return { status: "unavailable", reason: "no_usable_fields" };
  }
  const score = evaluateScoringFinalExpression(
    stored.configuration.finalExpression,
    aggregate,
  );
  return isScoringResult(score)
    ? { status: "available", score }
    : { status: "unavailable", reason: "invalid_final_calculation" };
}

export class BotBlockerRiskEventScoringService {
  constructor(private readonly configuration: ConfigurationStore) {}

  async calculate(
    report: CanonicalReportRequest,
    session: ClientSession,
  ): Promise<RiskEventScoreStatus> {
    return calculateRiskEventScore(
      report,
      await this.configuration.getConfiguration(session),
    );
  }
}

function aggregateFieldScores(
  report: CanonicalReportRequest,
  configuration: RiskEventScoringConfiguration,
): {
  weightedSum: number;
  presentWeightSum: number;
  presentFieldCount: number;
} {
  let weightedSum = 0;
  let presentWeightSum = 0;
  let presentFieldCount = 0;
  for (const field of configuration.fields) {
    if (!field.enabled) continue;
    const input = resolveRiskEventScoreInput(report, field.field);
    if (input === undefined) continue;
    const result = evaluateScoringFieldExpression(field.expression, input);
    if (!isScoringResult(result)) continue;
    const contribution = safeScoringNumber(result * field.weight);
    const nextWeight = safeScoringNumber(presentWeightSum + field.weight);
    const nextSum = contribution === undefined
      ? undefined
      : safeScoringNumber(weightedSum + contribution);
    if (nextSum === undefined || nextWeight === undefined) continue;
    weightedSum = nextSum;
    presentWeightSum = nextWeight;
    presentFieldCount += 1;
  }
  return { weightedSum, presentWeightSum, presentFieldCount };
}

function resolveRiskEventScoreInput(
  report: CanonicalReportRequest,
  field: RiskEventScoreableField,
): number | string | undefined {
  const evidence = report.payload.behaviorReport?.evidence ??
    report.payload.browserEvidence;
  const pageView = evidence?.pageView;
  const bins = pageView?.pointerHeatmap.bins;
  const indicators = evidence?.environment?.automationIndicators;
  const riskSignals = report.payload.riskSignals;

  switch (field) {
    case "request.method":
      return report.payload.request?.method;
    case "clicks.totalCount":
      return evidence ? evidence.clicks.length : undefined;
    case "clicks.button.count":
      return clickCount(evidence?.clicks, "button");
    case "clicks.link.count":
      return clickCount(evidence?.clicks, "link");
    case "clicks.form_field.count":
      return clickCount(evidence?.clicks, "form_field");
    case "clicks.form_submit.count":
      return clickCount(evidence?.clicks, "form_submit");
    case "clicks.navigation.count":
      return clickCount(evidence?.clicks, "navigation");
    case "clicks.honeypot.count":
      return clickCount(evidence?.clicks, "honeypot");
    case "clicks.other.count":
      return clickCount(evidence?.clicks, "other");
    case "mouseDirectness.averageDirectnessRatio":
      return evidence && evidence.mouseDirectness.sampleCount > 0
        ? usableNumber(evidence.mouseDirectness.averageDirectnessRatio)
        : undefined;
    case "mouseDirectness.sampleCount":
      return usableNumber(evidence?.mouseDirectness.sampleCount);
    case "scroll.smoothnessScore":
      return usableNumber(evidence?.scroll.smoothnessScore);
    case "scroll.highSpeedEventCount":
      return usableNumber(evidence?.scroll.highSpeedEventCount);
    case "honeypotActivations.count":
      return evidence ? evidence.honeypotActivations.length : undefined;
    case "pageView.durationMs":
      return usableNumber(pageView?.durationMs);
    case "pageView.activeDurationMs":
      return usableNumber(pageView?.activeDurationMs);
    case "pageView.documentWidth":
      return usableNumber(pageView?.documentWidth);
    case "pageView.documentHeight":
      return usableNumber(pageView?.documentHeight);
    case "pageView.pointerHeatmap.occupiedBinCount":
      return bins ? bins.length : undefined;
    case "pageView.pointerHeatmap.totalSampleCount":
      return bins ? sumNumbers(bins.map((bin) => bin.sampleCount)) : undefined;
    case "pageView.pointerHeatmap.totalDwellMs":
      return bins ? sumNumbers(bins.map((bin) => bin.dwellMs)) : undefined;
    case "automationIndicators.webdriver.present":
      return indicatorPresence(indicators, "webdriver");
    case "automationIndicators.untrusted_pointer.present":
      return indicatorPresence(indicators, "untrusted_pointer");
    case "automationIndicators.untrusted_click.present":
      return indicatorPresence(indicators, "untrusted_click");
    case "automationIndicators.untrusted_scroll.present":
      return indicatorPresence(indicators, "untrusted_scroll");
    case "riskSignals.honeypot_activation.count":
      return riskSignalCount(riskSignals, "honeypot_activation");
    case "riskSignals.automation_indicator.count":
      return riskSignalCount(riskSignals, "automation_indicator");
    case "riskSignals.velocity_anomaly.count":
      return riskSignalCount(riskSignals, "velocity_anomaly");
    case "riskSignals.challenge_failure.count":
      return riskSignalCount(riskSignals, "challenge_failure");
  }
}

function clickCount(
  clicks: BrowserEvidence["clicks"] | undefined,
  category: "button" | "link" | "form_field" | "form_submit" | "navigation" |
    "honeypot" | "other",
): number | undefined {
  return clicks
    ? clicks.filter((click) => click.category === category).length
    : undefined;
}

function indicatorPresence(
  indicators: readonly string[] | undefined,
  indicator: string,
): number | undefined {
  return indicators ? Number(indicators.includes(indicator)) : undefined;
}

function riskSignalCount(
  signals: CanonicalReportRequest["payload"]["riskSignals"],
  kind: "honeypot_activation" | "automation_indicator" | "velocity_anomaly" |
    "challenge_failure",
): number | undefined {
  return signals
    ? signals.filter((signal) => signal.kind === kind).length
    : undefined;
}

function sumNumbers(values: number[]): number | undefined {
  let sum = 0;
  for (const value of values) {
    const next = safeScoringNumber(sum + value);
    if (next === undefined) return undefined;
    sum = next;
  }
  return sum;
}

function usableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? safeScoringNumber(value) : undefined;
}
