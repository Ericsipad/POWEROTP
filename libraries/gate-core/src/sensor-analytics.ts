import { POINTER_HEATMAP_GRID_SIZE } from "@powerotp/contracts";

const MAX_POINTER_DWELL_STEP_MS = 250;

export interface SensorPoint {
  x: number;
  y: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

export interface PageMetadata {
  pageId?: string;
  pageName?: string;
  navigationTargetPath?: string;
}

export type PointerHeatmap = Map<
  string,
  { column: number; row: number; sampleCount: number; dwellMs: number }
>;

export function pagePoint(
  event: MouseEvent | PointerEvent,
  window: Window,
): SensorPoint {
  return {
    x: Number.isFinite(event.pageX) ? event.pageX : event.clientX + window.scrollX,
    y: Number.isFinite(event.pageY) ? event.pageY : event.clientY + window.scrollY,
  };
}

export function pageDimensions(document: Document): PageDimensions {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(
      1,
      root?.scrollWidth ?? 0,
      root?.clientWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.clientWidth ?? 0,
    ),
    height: Math.max(
      1,
      root?.scrollHeight ?? 0,
      root?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.clientHeight ?? 0,
    ),
  };
}

export function pageMetadata(document: Document): PageMetadata {
  const root = document.documentElement;
  const body = document.body;
  const pageId = root?.getAttribute("data-powerotp-page-id") ??
    body?.getAttribute("data-powerotp-page-id") ??
    undefined;
  const pageName = root?.getAttribute("data-powerotp-page-name") ??
    body?.getAttribute("data-powerotp-page-name") ??
    undefined;
  return {
    ...(pageId ? { pageId } : {}),
    ...(pageName ? { pageName } : {}),
  };
}

export function safePageName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized &&
      normalized.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

export function normalizedPosition(
  point: SensorPoint,
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

export function heatmapBin(
  point: SensorPoint,
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

export function addPointerDwell(
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

export function boundedDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1_000_000, Math.round(value)));
}

export function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(86_400_000, Math.round(value)));
}

export function isFinitePoint(point: SensorPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
