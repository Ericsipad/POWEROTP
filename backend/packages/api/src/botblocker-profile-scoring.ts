import type {
  ProfileFieldScoreExpression,
  ProfileScoreFinalExpression,
  ProfileScoreStatus,
  ProfileScoreableField,
  ProfileScoringConfiguration,
} from "@powerotp/contracts";

import type {
  BotBlockerIntelligencePersistence,
  BotBlockerScope,
  UserIntelligenceDocument,
} from "./botblocker-intelligence-persistence.js";
import type {
  BotBlockerProfileScoringPersistence,
  ProfileScoringConfigurationDocument,
} from "./botblocker-profile-scoring-persistence.js";

type ConfigurationStore = Pick<
  BotBlockerProfileScoringPersistence,
  "getConfiguration"
>;
type IntelligenceStore = Pick<
  BotBlockerIntelligencePersistence,
  "findUserIntelligence" | "replaceCurrentScore"
>;
export type ScoringExpressionInput =
  | number
  | string
  | readonly boolean[]
  | { width: number | null; height: number | null }
  | {
    maxTouchPoints: number;
    touchEvent: boolean;
    touchStart: boolean;
  };

export function calculateProfileScore(
  profile: UserIntelligenceDocument,
  stored: ProfileScoringConfigurationDocument | null,
): ProfileScoreStatus {
  if (!stored) {
    return { status: "unavailable", reason: "scoring_unconfigured" };
  }
  const aggregate = aggregateFieldScores(profile, stored.configuration);
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

export class BotBlockerProfileScoringService {
  constructor(
    private readonly configuration: ConfigurationStore,
    private readonly intelligence: IntelligenceStore,
  ) {}

  async recalculate(
    scope: BotBlockerScope,
    userIntelligenceId: string,
  ): Promise<ProfileScoreStatus | undefined> {
    const [configuration, profile] = await Promise.all([
      this.configuration.getConfiguration(),
      this.intelligence.findUserIntelligence(scope, userIntelligenceId),
    ]);
    if (!profile) return undefined;
    const currentScore = calculateProfileScore(profile, configuration);
    const replaced = await this.intelligence.replaceCurrentScore(
      scope,
      userIntelligenceId,
      profile.updatedAt,
      currentScore,
    );
    return replaced ? currentScore : undefined;
  }
}

function aggregateFieldScores(
  profile: UserIntelligenceDocument,
  configuration: ProfileScoringConfiguration,
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
    const input = resolveScoreInput(profile, field.field);
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

function resolveScoreInput(
  profile: UserIntelligenceDocument,
  field: ProfileScoreableField,
): ScoringExpressionInput | undefined {
  switch (field) {
    case "osCpu":
      return profile.osCpu;
    case "screenResolution":
      return profile.screenResolution;
    case "platform":
      return profile.platform;
    case "touchSupport":
      return profile.touchSupport;
    case "vendor":
      return profile.vendor;
    case "architecture":
      return usableNumber(profile.architecture);
    case "applePay":
      return usableNumber(profile.applePay);
    case "currentIp.asnScore":
      return usableNumber(profile.currentIp?.asnScore);
    case "recentIpHistory.count":
      return usableNumber(profile.recentIpHistory.length);
    case "recentIpHistory.asnAverage":
      return average(
        profile.recentIpHistory.flatMap((entry) =>
          entry.asnScore === undefined ? [] : [entry.asnScore]
        ),
      );
    case "recentIpHistory.blacklisted":
      return profile.recentIpHistory.map((entry) => entry.blacklisted);
    case "currentIpReuse.global.distinctProfiles1d":
      return usableNumber(profile.currentIpReuse?.global.distinctProfiles1d);
    case "currentIpReuse.global.distinctProfiles7d":
      return usableNumber(profile.currentIpReuse?.global.distinctProfiles7d);
    case "currentIpReuse.global.distinctProfiles30d":
      return usableNumber(profile.currentIpReuse?.global.distinctProfiles30d);
    case "currentIpReuse.site.distinctProfiles1d":
      return usableNumber(profile.currentIpReuse?.site.distinctProfiles1d);
    case "currentIpReuse.site.distinctProfiles7d":
      return usableNumber(profile.currentIpReuse?.site.distinctProfiles7d);
    case "currentIpReuse.site.distinctProfiles30d":
      return usableNumber(profile.currentIpReuse?.site.distinctProfiles30d);
  }
}

export function evaluateScoringFieldExpression(
  expression: ProfileFieldScoreExpression,
  input: ScoringExpressionInput,
): number | undefined {
  const node = expression as ExpressionNode;
  if (node.op === "input") {
    return usableNumber(resolveFieldInput(input, node.name));
  }
  if (node.op === "count") {
    return Array.isArray(input) ? usableNumber(input.length) : undefined;
  }
  if (node.op === "true_count") {
    return Array.isArray(input)
      ? usableNumber(input.filter(Boolean).length)
      : undefined;
  }
  if (node.op === "true_ratio") {
    return Array.isArray(input) && input.length > 0
      ? safeScoringNumber(input.filter(Boolean).length / input.length)
      : undefined;
  }
  if (node.op === "compare") {
    return compare(
      resolveFieldInput(input, node.input),
      node.comparison!,
      node.expected,
    )
      ? usableNumber(node.whenTrue)
      : usableNumber(node.whenFalse);
  }
  return evaluateNumericExpression(node, (child) =>
    evaluateScoringFieldExpression(child as ProfileFieldScoreExpression, input)
  );
}

export function evaluateScoringFinalExpression(
  expression: ProfileScoreFinalExpression,
  values: {
    weightedSum: number;
    presentWeightSum: number;
    presentFieldCount: number;
  },
): number | undefined {
  const node = expression as ExpressionNode;
  if (node.op === "variable") {
    return usableNumber(values[node.name as keyof typeof values]);
  }
  return evaluateNumericExpression(node, (child) =>
    evaluateScoringFinalExpression(child as ProfileScoreFinalExpression, values)
  );
}

function evaluateNumericExpression(
  node: ExpressionNode,
  evaluateChild: (child: unknown) => number | undefined,
): number | undefined {
  if (node.op === "literal") return usableNumber(node.value);
  if (node.op === "abs" || node.op === "negate") {
    const value = evaluateChild(node.value);
    if (value === undefined) return undefined;
    return safeScoringNumber(node.op === "abs" ? Math.abs(value) : -value);
  }
  if (!node.left || !node.right) return undefined;
  const left = evaluateChild(node.left);
  const right = evaluateChild(node.right);
  if (left === undefined || right === undefined) return undefined;
  switch (node.op) {
    case "add":
      return safeScoringNumber(left + right);
    case "subtract":
      return safeScoringNumber(left - right);
    case "multiply":
      return safeScoringNumber(left * right);
    case "divide":
      return right === 0 ? undefined : safeScoringNumber(left / right);
    case "min":
      return safeScoringNumber(Math.min(left, right));
    case "max":
      return safeScoringNumber(Math.max(left, right));
    default:
      return undefined;
  }
}

interface ExpressionNode {
  op: string;
  value?: unknown;
  name?: string;
  input?: string;
  left?: unknown;
  right?: unknown;
  comparison?: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
  expected?: unknown;
  whenTrue?: number;
  whenFalse?: number;
}

function compare(
  input: unknown,
  comparison: NonNullable<ExpressionNode["comparison"]>,
  expected: unknown,
): boolean {
  if (typeof input !== typeof expected) return false;
  if (comparison === "eq") return input === expected;
  if (comparison === "neq") return input !== expected;
  if (typeof input !== "number" || typeof expected !== "number") return false;
  if (comparison === "lt") return input < expected;
  if (comparison === "lte") return input <= expected;
  if (comparison === "gt") return input > expected;
  return input >= expected;
}

function resolveFieldInput(
  input: ScoringExpressionInput,
  name: string | undefined,
): unknown {
  if (name === "value") {
    return typeof input === "number" || typeof input === "string"
      ? input
      : undefined;
  }
  if (Array.isArray(input) || typeof input !== "object") return undefined;
  if (name === "width" || name === "height") {
    return "width" in input ? input[name] : undefined;
  }
  if (
    name === "maxTouchPoints" ||
    name === "touchEvent" ||
    name === "touchStart"
  ) {
    return "maxTouchPoints" in input ? input[name] : undefined;
  }
  return undefined;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  let sum = 0;
  for (const value of values) {
    const next = safeScoringNumber(sum + value);
    if (next === undefined) return undefined;
    sum = next;
  }
  return safeScoringNumber(sum / values.length);
}

function usableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? safeScoringNumber(value) : undefined;
}

export function safeScoringNumber(value: number): number | undefined {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

export function isScoringResult(value: number | undefined): value is number {
  return value !== undefined && value >= 0 && value <= 100;
}
