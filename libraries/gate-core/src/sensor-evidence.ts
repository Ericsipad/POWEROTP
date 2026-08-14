import {
  BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
  BrowserEnvironmentEvidenceSchema,
  BrowserEvidenceSchema,
  browserAutomationIndicators,
  type BrowserAutomationIndicator,
  type BrowserEvidence,
  type ClickObservation,
} from "@powerotp/contracts";

const MAX_ROUTE_LENGTH = 2_048;
const MAX_CLICKS = 200;
const MAX_HONEYPOTS = 50;
const HIGH_SPEED_SCROLL_PX_PER_MS = 3;
const SAFE_EXPLICIT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

interface Point {
  x: number;
  y: number;
}

export interface SensorEvidenceAccumulator {
  recordPointer(point: Point, trusted: boolean): void;
  recordClick(point: Point, target: EventTarget | null, trusted: boolean): void;
  recordScroll(position: number, at: number, trusted: boolean): void;
  snapshot(routePath: string): BrowserEvidence;
  reset(): void;
}

export interface SensorEvidenceOptions {
  sensorVersion: string;
  webdriver: boolean;
}

export function sanitizeRoutePath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.split(/[?#]/, 1)[0] ?? "/";
  if (
    !path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return "/";
  }
  return path.slice(0, MAX_ROUTE_LENGTH) || "/";
}

export function createSensorEvidenceAccumulator(
  options: SensorEvidenceOptions,
): SensorEvidenceAccumulator {
  const environment = BrowserEnvironmentEvidenceSchema.parse({
    evidenceVersion: BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
    sensorVersion: options.sensorVersion,
    automationIndicators: options.webdriver ? ["webdriver"] : [],
  });
  const indicators = new Set<BrowserAutomationIndicator>();
  let clicks: ClickObservation[] = [];
  let honeypotIds: string[] = [];
  let segmentStart: Point | undefined;
  let previousPoint: Point | undefined;
  let pathDistance = 0;
  let directnessTotal = 0;
  let directnessSamples = 0;
  let previousScroll: { position: number; at: number; speed?: number } | undefined;
  let smoothnessTotal = 0;
  let smoothnessSamples = 0;
  let highSpeedEventCount = 0;

  const mark = (indicator: BrowserAutomationIndicator) => indicators.add(indicator);

  const reset = () => {
    clicks = [];
    honeypotIds = [];
    segmentStart = undefined;
    previousPoint = undefined;
    pathDistance = 0;
    directnessTotal = 0;
    directnessSamples = 0;
    previousScroll = undefined;
    smoothnessTotal = 0;
    smoothnessSamples = 0;
    highSpeedEventCount = 0;
    indicators.clear();
    if (options.webdriver) mark("webdriver");
  };

  reset();

  return {
    recordPointer(point, trusted) {
      if (!trusted) mark("untrusted_pointer");
      if (!isFinitePoint(point) || !segmentStart || !previousPoint) return;
      pathDistance += distance(previousPoint, point);
      previousPoint = point;
    },

    recordClick(point, target, trusted) {
      if (!trusted) mark("untrusted_click");
      if (isFinitePoint(point)) {
        if (segmentStart && previousPoint) {
          pathDistance += distance(previousPoint, point);
          if (pathDistance > 0) {
            directnessTotal += clamp(distance(segmentStart, point) / pathDistance);
            directnessSamples += 1;
          }
        }
        segmentStart = point;
        previousPoint = point;
        pathDistance = 0;
      }

      const observation = observeClickTarget(target);
      if (clicks.length < MAX_CLICKS) clicks.push(observation.click);
      if (observation.honeypotId && honeypotIds.length < MAX_HONEYPOTS) {
        honeypotIds.push(observation.honeypotId);
      }
    },

    recordScroll(position, at, trusted) {
      if (!trusted) mark("untrusted_scroll");
      if (!Number.isFinite(position) || !Number.isFinite(at)) return;
      if (!previousScroll) {
        previousScroll = { position, at };
        return;
      }

      const elapsed = at - previousScroll.at;
      if (elapsed <= 0) return;
      const speed = Math.abs(position - previousScroll.position) / elapsed;
      if (speed > HIGH_SPEED_SCROLL_PX_PER_MS) highSpeedEventCount += 1;
      if (previousScroll.speed !== undefined) {
        const denominator = Math.max(speed, previousScroll.speed, 0.001);
        smoothnessTotal += clamp(1 - Math.abs(speed - previousScroll.speed) / denominator);
        smoothnessSamples += 1;
      }
      previousScroll = { position, at, speed };
    },

    snapshot(routePath) {
      const automationIndicators = browserAutomationIndicators.filter((indicator) =>
        indicators.has(indicator),
      );
      return BrowserEvidenceSchema.parse({
        routePath: sanitizeRoutePath(routePath),
        clicks,
        mouseDirectness: {
          averageDirectnessRatio:
            directnessSamples === 0 ? 0 : round(directnessTotal / directnessSamples),
          sampleCount: directnessSamples,
        },
        scroll: {
          smoothnessScore:
            smoothnessSamples === 0 ? 0 : round(smoothnessTotal / smoothnessSamples),
          highSpeedEventCount,
        },
        honeypotActivations: honeypotIds.map((honeypotId) => ({ honeypotId })),
        environment: {
          evidenceVersion: BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
          sensorVersion: environment.sensorVersion,
          automationIndicators,
        },
      });
    },

    reset,
  };
}

function observeClickTarget(target: EventTarget | null): {
  click: ClickObservation;
  honeypotId?: string;
} {
  const element = asElement(target);
  if (!element) return { click: { category: "other" } };

  const identified = element.closest("[data-powerotp-id]");
  const powerOtpId = safeExplicitId(identified?.getAttribute("data-powerotp-id"));
  const honeypot = element.closest("[data-powerotp-honeypot-id]");
  const honeypotId = safeExplicitId(honeypot?.getAttribute("data-powerotp-honeypot-id"));
  const actionable = element.closest(
    "button,a,input,select,textarea,form,[role='button'],[role='link'],nav,[role='navigation']",
  );
  const tag = actionable?.tagName.toLowerCase();
  const role = actionable?.getAttribute("role");
  const inputType = actionable?.getAttribute("type")?.toLowerCase();

  let category: ClickObservation["category"] = "other";
  if (honeypotId) category = "honeypot";
  else if (tag === "a" || role === "link") category = "link";
  else if (tag === "nav" || role === "navigation") category = "navigation";
  else if (tag === "form" || inputType === "submit") category = "form_submit";
  else if (tag === "button" || role === "button") category = "button";
  else if (tag === "input" || tag === "select" || tag === "textarea") category = "form_field";

  return {
    click: { category, ...(powerOtpId ? { powerOtpId } : {}) },
    ...(honeypotId ? { honeypotId } : {}),
  };
}

function asElement(target: EventTarget | null): Element | undefined {
  if (!target || typeof target !== "object") return undefined;
  const candidate = target as Partial<Element>;
  return typeof candidate.closest === "function" ? (candidate as Element) : undefined;
}

function safeExplicitId(value: string | null | undefined): string | undefined {
  return value && SAFE_EXPLICIT_ID.test(value) ? value : undefined;
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
