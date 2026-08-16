import {
  BROWSER_ENVIRONMENT_EVIDENCE_VERSION,
  BrowserEnvironmentEvidenceSchema,
  BrowserEvidenceSchema,
  POINTER_HEATMAP_GRID_SIZE,
  browserAutomationIndicators,
  type BrowserAutomationIndicator,
  type BrowserEvidence,
  type ClickObservation,
} from "@powerotp/contracts";

const MAX_ROUTE_LENGTH = 2_048;
const MAX_CLICKS = 200;
const MAX_HONEYPOTS = 50;
const HIGH_SPEED_SCROLL_PX_PER_MS = 3;
const MAX_POINTER_DWELL_STEP_MS = 250;
const SAFE_EXPLICIT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

interface Point {
  x: number;
  y: number;
}

interface PageDimensions {
  width: number;
  height: number;
}

interface PageMetadata {
  pageId?: string;
  pageName?: string;
  navigationTargetPath?: string;
}

type PointerHeatmap = Map<
  string,
  { column: number; row: number; sampleCount: number; dwellMs: number }
>;

export interface SensorEvidenceAccumulator {
  recordPointer(
    point: Point,
    dimensions: PageDimensions,
    at: number,
    trusted: boolean,
  ): void;
  recordClick(
    point: Point,
    dimensions: PageDimensions,
    target: EventTarget | null,
    trusted: boolean,
  ): void;
  recordScroll(position: number, at: number, trusted: boolean): void;
  snapshot(
    routePath: string,
    dimensions: PageDimensions,
    metadata?: PageMetadata,
    at?: number,
  ): BrowserEvidence;
  reset(): void;
}

export interface SensorEvidenceOptions {
  sensorVersion: string;
  webdriver: boolean;
  now?: () => number;
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
  const now = options.now ?? Date.now;
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
  let intervalStartedAt = now();
  let pointerHeatmap: PointerHeatmap = new Map();
  let previousPointerBin:
    | { key: string; at: number }
    | undefined;

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
    intervalStartedAt = now();
    pointerHeatmap = new Map();
    previousPointerBin = undefined;
    indicators.clear();
    if (options.webdriver) mark("webdriver");
  };

  reset();

  return {
    recordPointer(point, dimensions, at, trusted) {
      if (!trusted) mark("untrusted_pointer");
      if (!isFinitePoint(point)) return;
      const bin = heatmapBin(point, dimensions);
      if (bin) {
        addPointerDwell(pointerHeatmap, previousPointerBin, at);
        const current = pointerHeatmap.get(bin.key);
        pointerHeatmap.set(bin.key, {
          column: bin.column,
          row: bin.row,
          sampleCount: (current?.sampleCount ?? 0) + 1,
          dwellMs: current?.dwellMs ?? 0,
        });
        previousPointerBin = { key: bin.key, at };
      }
      if (!segmentStart || !previousPoint) return;
      pathDistance += distance(previousPoint, point);
      previousPoint = point;
    },

    recordClick(point, dimensions, target, trusted) {
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
      if (clicks.length < MAX_CLICKS) {
        const position = normalizedPosition(point, dimensions);
        clicks.push({
          ...observation.click,
          ...(position ? { position } : {}),
        });
      }
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

    snapshot(routePath, dimensions, metadata = {}, at = now()) {
      addPointerDwell(pointerHeatmap, previousPointerBin, at);
      if (previousPointerBin) {
        previousPointerBin = { ...previousPointerBin, at };
      }
      const automationIndicators = browserAutomationIndicators.filter((indicator) =>
        indicators.has(indicator),
      );
      const durationMs = boundedDuration(at - intervalStartedAt);
      const pageId = safeExplicitId(metadata.pageId);
      const pageName = safePageName(metadata.pageName);
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
        pageView: {
          ...(pageId ? { pageId } : {}),
          ...(pageName ? { pageName } : {}),
          durationMs,
          activeDurationMs: durationMs,
          documentWidth: boundedDimension(dimensions.width),
          documentHeight: boundedDimension(dimensions.height),
          pointerHeatmap: {
            gridSize: POINTER_HEATMAP_GRID_SIZE,
            bins: [...pointerHeatmap.values()]
              .sort((left, right) =>
                left.row - right.row || left.column - right.column
              )
              .map((bin) => ({
                ...bin,
                dwellMs: Math.round(bin.dwellMs),
              })),
          },
          ...(metadata.navigationTargetPath
            ? {
                navigationTargetPath: sanitizeRoutePath(
                  metadata.navigationTargetPath,
                ),
              }
            : {}),
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

function safePageName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized &&
      normalized.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function normalizedPosition(
  point: Point,
  dimensions: PageDimensions,
): { xRatio: number; yRatio: number } | undefined {
  if (!isFinitePoint(point)) return undefined;
  const width = boundedDimension(dimensions.width);
  const height = boundedDimension(dimensions.height);
  return {
    xRatio: round(clamp(point.x / width)),
    yRatio: round(clamp(point.y / height)),
  };
}

function heatmapBin(
  point: Point,
  dimensions: PageDimensions,
): { key: string; column: number; row: number } | undefined {
  const position = normalizedPosition(point, dimensions);
  if (!position) return undefined;
  const column = Math.min(
    POINTER_HEATMAP_GRID_SIZE - 1,
    Math.floor(position.xRatio * POINTER_HEATMAP_GRID_SIZE),
  );
  const row = Math.min(
    POINTER_HEATMAP_GRID_SIZE - 1,
    Math.floor(position.yRatio * POINTER_HEATMAP_GRID_SIZE),
  );
  return { key: `${column}:${row}`, column, row };
}

function addPointerDwell(
  heatmap: PointerHeatmap,
  previous: { key: string; at: number } | undefined,
  at: number,
): void {
  if (!previous || !Number.isFinite(at)) return;
  const bin = heatmap.get(previous.key);
  if (!bin) return;
  const elapsed = Math.max(0, Math.min(MAX_POINTER_DWELL_STEP_MS, at - previous.at));
  bin.dwellMs += elapsed;
}

function boundedDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1_000_000, Math.round(value)));
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(86_400_000, Math.round(value)));
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
