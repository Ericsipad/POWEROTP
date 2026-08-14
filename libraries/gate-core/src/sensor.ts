import {
  BEHAVIOR_REPORT_INITIAL_DELAY_MS,
  BEHAVIOR_REPORT_RECURRING_INTERVAL_MS,
  BehaviorReportSchema,
  BOTBLOCKER_PROTOCOL_VERSION,
  type BehaviorReport,
  type PartialBehaviorReportReason,
} from "@powerotp/contracts";
import type { GateEffect } from "./controller.js";
import {
  createSensorEvidenceAccumulator,
  sanitizeRoutePath,
} from "./sensor-evidence.js";

type SensorTimer = number | ReturnType<typeof setTimeout>;

export interface ContinuousBrowserSensorOptions {
  window: Window;
  document: Document;
  gateSessionId: string;
  sensorVersion: string;
  /** Trusted adapter-provided next sequence for this gate session. */
  startingSequence: number;
  /**
   * Returns an opaque server decision candidate, or undefined when no
   * decision was delivered. This package never fabricates one.
   */
  sendReport(report: BehaviorReport): Promise<unknown | undefined>;
  /**
   * Must be gate-core's verifier-backed decision revision entry point.
   * Raw report responses never gain authority inside the sensor.
   */
  applyDecisionRevision(candidate: unknown): Promise<boolean>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => SensorTimer;
  clearTimer?: (timer: SensorTimer) => void;
}

export interface ContinuousBrowserSensor {
  start(fresh?: boolean): void;
  pause(): void;
  handleGateEffect(effect: GateEffect): void;
  recordNavigation(pathname?: string): void;
  isObserving(): boolean;
  getNextSequence(): number;
  dispose(): void;
}

export function createContinuousBrowserSensor(
  options: ContinuousBrowserSensorOptions,
): ContinuousBrowserSensor {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const startingSequence = options.startingSequence;
  if (!Number.isSafeInteger(startingSequence) || startingSequence < 0) {
    throw new Error("Sensor starting sequence must be a non-negative safe integer");
  }

  const evidence = createSensorEvidenceAccumulator({
    sensorVersion: options.sensorVersion,
    webdriver: options.window.navigator.webdriver === true,
  });
  let routePath = sanitizeRoutePath(options.window.location.pathname);
  let nextSequence = startingSequence;
  let initialSent = false;
  let active = false;
  let hidden = false;
  let disposed = false;
  let generation = 0;
  let timer: SensorTimer | undefined;

  const clearScheduled = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const send = (report: BehaviorReport, reportGeneration: number) => {
    let pending: Promise<unknown | undefined>;
    try {
      pending = options.sendReport(report);
    } catch {
      return;
    }
    void pending.then(
      (candidate) => {
        if (
          candidate === undefined ||
          disposed ||
          !active ||
          generation !== reportGeneration
        ) {
          return;
        }
        void options.applyDecisionRevision(candidate).catch(() => {});
      },
      () => {},
    );
  };

  const emit = (
    trigger: "initial" | "recurring" | "partial",
    reason?: PartialBehaviorReportReason,
  ) => {
    if (nextSequence === Number.MAX_SAFE_INTEGER) {
      sensor.pause();
      return;
    }
    const sequence = nextSequence;
    nextSequence += 1;
    const report = BehaviorReportSchema.parse({
      protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
      trigger,
      ...(trigger === "partial" ? { reason } : {}),
      sequence: {
        gateSessionId: options.gateSessionId,
        sequence,
        issuedAt: Math.max(1, Math.floor(now())),
      },
      evidence: evidence.snapshot(routePath),
    });
    send(report, generation);
    evidence.reset();
  };

  const scheduleNext = () => {
    clearScheduled();
    if (!active || hidden || disposed) return;
    const scheduledGeneration = generation;
    const delay = initialSent
      ? BEHAVIOR_REPORT_RECURRING_INTERVAL_MS
      : BEHAVIOR_REPORT_INITIAL_DELAY_MS;
    timer = setTimer(() => {
      timer = undefined;
      if (
        !active ||
        hidden ||
        disposed ||
        generation !== scheduledGeneration
      ) {
        return;
      }
      const trigger = initialSent ? "recurring" : "initial";
      emit(trigger);
      initialSent = true;
      scheduleNext();
    }, delay);
  };

  const closePartial = (reason: PartialBehaviorReportReason) => {
    if (!active || hidden || disposed) return;
    clearScheduled();
    emit("partial", reason);
  };

  const recordNavigation = (pathname = options.window.location.pathname) => {
    if (!active || hidden || disposed) return;
    closePartial("navigation");
    routePath = sanitizeRoutePath(pathname);
    evidence.reset();
    scheduleNext();
  };

  const onPointerMove = (event: Event) => {
    if (!active || hidden) return;
    const pointer = event as PointerEvent;
    evidence.recordPointer(
      { x: pointer.clientX, y: pointer.clientY },
      pointer.isTrusted,
    );
  };
  const onClick = (event: Event) => {
    if (!active || hidden) return;
    const mouse = event as MouseEvent;
    evidence.recordClick(
      { x: mouse.clientX, y: mouse.clientY },
      event.target,
      mouse.isTrusted,
    );
  };
  const onScroll = (event: Event) => {
    if (!active || hidden) return;
    evidence.recordScroll(options.window.scrollY, event.timeStamp, event.isTrusted);
  };
  const onVisibilityChange = () => {
    if (!active || disposed) return;
    if (options.document.visibilityState === "hidden") {
      if (!hidden) {
        closePartial("hide");
        hidden = true;
        clearScheduled();
      }
      return;
    }
    if (hidden) {
      hidden = false;
      routePath = sanitizeRoutePath(options.window.location.pathname);
      evidence.reset();
      scheduleNext();
    }
  };
  const onExit = () => {
    if (!active || disposed) return;
    closePartial("exit");
    active = false;
    generation += 1;
    clearScheduled();
    evidence.reset();
  };
  const onPopState = () => recordNavigation();
  const onHashChange = () => recordNavigation();

  options.document.addEventListener("pointermove", onPointerMove, { passive: true });
  options.document.addEventListener("click", onClick, { capture: true, passive: true });
  options.window.addEventListener("scroll", onScroll, { passive: true });
  options.window.addEventListener("popstate", onPopState);
  options.window.addEventListener("hashchange", onHashChange);
  options.document.addEventListener("visibilitychange", onVisibilityChange);
  options.window.addEventListener("pagehide", onExit);

  const history = options.window.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    recordNavigation();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    recordNavigation();
  };

  const sensor: ContinuousBrowserSensor = {
    start(fresh = false) {
      if (disposed || (active && !fresh)) return;
      generation += 1;
      active = true;
      hidden = options.document.visibilityState === "hidden";
      routePath = sanitizeRoutePath(options.window.location.pathname);
      evidence.reset();
      scheduleNext();
    },

    pause() {
      if (disposed) return;
      active = false;
      hidden = false;
      generation += 1;
      clearScheduled();
      evidence.reset();
    },

    handleGateEffect(effect) {
      if (effect.type === "pause_observation") sensor.pause();
      if (effect.type === "start_observation") sensor.start(effect.fresh);
    },

    recordNavigation,
    isObserving: () => active && !hidden,
    getNextSequence: () => nextSequence,

    dispose() {
      if (disposed) return;
      sensor.pause();
      disposed = true;
      options.document.removeEventListener("pointermove", onPointerMove);
      options.document.removeEventListener("click", onClick, true);
      options.window.removeEventListener("scroll", onScroll);
      options.window.removeEventListener("popstate", onPopState);
      options.window.removeEventListener("hashchange", onHashChange);
      options.document.removeEventListener("visibilitychange", onVisibilityChange);
      options.window.removeEventListener("pagehide", onExit);
      if (history.pushState === patchedPushState) history.pushState = originalPushState;
      if (history.replaceState === patchedReplaceState) {
        history.replaceState = originalReplaceState;
      }
    },
  };

  const patchedPushState = history.pushState;
  const patchedReplaceState = history.replaceState;
  return sensor;
}
