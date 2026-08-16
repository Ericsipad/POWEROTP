import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type BehaviorReport,
} from "@powerotp/contracts";
import { Window as HappyWindow } from "happy-dom";
import { createGateController } from "./controller.js";
import { createContinuousBrowserSensor } from "./sensor.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "site_phase10_12345";
const SESSION_ID = "gate_session_phase10";
const AUDIENCE = "https://customer.example";

class Timers {
  private nextId = 1;
  private tasks = new Map<number, { callback: () => void; delay: number }>();

  set = (callback: () => void, delay: number) => {
    const id = this.nextId++;
    this.tasks.set(id, { callback, delay });
    return id;
  };

  clear = (id: number | ReturnType<typeof setTimeout>) => {
    this.tasks.delete(id as number);
  };

  nextDelay(): number | undefined {
    return this.tasks.values().next().value?.delay;
  }

  runNext(): void {
    const entry = this.tasks.entries().next().value;
    assert.ok(entry, "expected a scheduled timer");
    const [id, task] = entry;
    this.tasks.delete(id);
    task.callback();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function browser(url = `${AUDIENCE}/start?secret=query`) {
  const happy = new HappyWindow({ url });
  return {
    window: happy as unknown as Window,
    document: happy.document as unknown as Document,
    event: (type: string, init?: EventInit) =>
      new happy.Event(type, init) as unknown as Event,
  };
}

function decision(sequence: number, outcome: "allow" | "otp" = "allow") {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId: SITE_ID,
    sequence: { gateSessionId: SESSION_ID, sequence, issuedAt: NOW + sequence },
    outcome,
    audience: AUDIENCE,
    nonce: `nonce_phase10_${sequence}`.padEnd(16, "0"),
    expiresAt: NOW + 60_000,
  };
}

describe("continuous browser sensor cadence", () => {
  it("rejects invalid sequence and sensor versions before observation", () => {
    const create = (startingSequence: number, sensorVersion: string) => {
      const { window, document } = browser();
      return createContinuousBrowserSensor({
        window,
        document,
        gateSessionId: SESSION_ID,
        sensorVersion,
        startingSequence,
        sendReport: async () => undefined,
        applyDecisionRevision: async () => false,
      });
    };

    assert.throws(() => create(-1, "sensor-1.0.0"), /non-negative safe integer/);
    assert.throws(() => create(0, "sensor version with spaces"));
  });

  it("sends the initial report at five seconds and recurring reports every 30 seconds", async () => {
    const { window, document } = browser();
    const timers = new Timers();
    const reports: BehaviorReport[] = [];
    document.documentElement.setAttribute("data-powerotp-page-id", "start");
    document.documentElement.setAttribute(
      "data-powerotp-page-name",
      "Getting started",
    );
    const sensor = createContinuousBrowserSensor({
      window,
      document,
      gateSessionId: SESSION_ID,
      sensorVersion: "sensor-1.0.0",
      startingSequence: 4,
      now: () => NOW,
      setTimer: timers.set,
      clearTimer: timers.clear,
      sendReport: async (report) => {
        reports.push(report);
        return undefined;
      },
      applyDecisionRevision: async () => false,
    });

    sensor.start();
    assert.equal(timers.nextDelay(), 5_000);
    timers.runNext();
    await flushPromises();
    assert.equal(timers.nextDelay(), 30_000);
    timers.runNext();
    await flushPromises();

    assert.deepEqual(
      reports.map((report) => [report.trigger, report.sequence.sequence]),
      [["initial", 4], ["recurring", 5]],
    );
    assert.equal(reports[0]?.evidence.routePath, "/start");
    assert.equal(reports[0]?.evidence.pageView?.pageId, "start");
    assert.equal(reports[0]?.evidence.pageView?.pageName, "Getting started");
    assert.equal(reports[0]?.evidence.pageView?.pointerHeatmap.gridSize, 32);
    assert.equal(JSON.stringify(reports).includes("secret=query"), false);
    sensor.dispose();
  });

  it("sends sanitized partial reports on navigation, hide, and exit", () => {
    const { window, document, event } = browser();
    const timers = new Timers();
    const reports: BehaviorReport[] = [];
    const sensor = createContinuousBrowserSensor({
      window,
      document,
      gateSessionId: SESSION_ID,
      sensorVersion: "sensor-1.0.0",
      startingSequence: 0,
      now: () => NOW,
      setTimer: timers.set,
      clearTimer: timers.clear,
      sendReport: async (report) => {
        reports.push(report);
        return undefined;
      },
      applyDecisionRevision: async () => false,
    });
    sensor.start();

    window.history.pushState({}, "", "/next?credential=secret#fragment");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(event("visibilitychange"));
    window.dispatchEvent(event("pagehide"));

    assert.deepEqual(
      reports.map((report) =>
        report.trigger === "partial"
          ? [report.reason, report.evidence.routePath]
          : [report.trigger, report.evidence.routePath],
      ),
      [["navigation", "/start"], ["hide", "/next"], ["exit", "/next"]],
    );
    assert.equal(JSON.stringify(reports).includes("credential=secret"), false);
    assert.equal(
      reports[0]?.evidence.pageView?.navigationTargetPath,
      "/next",
    );
    assert.equal(sensor.isObserving(), false);
    sensor.dispose();
  });
});

describe("continuous sensor gate integration", () => {
  it("discards a pre-OTP interval and its response, then resumes fresh", async () => {
    const { window, document, event } = browser();
    const timers = new Timers();
    const firstResponse = deferred<unknown>();
    const reports: BehaviorReport[] = [];
    const applied: unknown[] = [];
    const sensor = createContinuousBrowserSensor({
      window,
      document,
      gateSessionId: SESSION_ID,
      sensorVersion: "sensor-1.0.0",
      startingSequence: 0,
      now: () => NOW,
      setTimer: timers.set,
      clearTimer: timers.clear,
      sendReport: (report) => {
        reports.push(report);
        return reports.length === 1
          ? firstResponse.promise
          : Promise.resolve(decision(2));
      },
      applyDecisionRevision: async (candidate) => {
        applied.push(candidate);
        return true;
      },
    });

    sensor.handleGateEffect({ type: "start_observation", fresh: false });
    document.body.innerHTML = '<button data-powerotp-id="before-otp">Before</button>';
    document
      .querySelector("button")
      ?.dispatchEvent(event("click", { bubbles: true }));
    timers.runNext();
    sensor.handleGateEffect({ type: "pause_observation" });
    firstResponse.resolve(decision(1));
    await flushPromises();
    assert.deepEqual(applied, []);

    sensor.handleGateEffect({ type: "start_observation", fresh: true });
    assert.equal(timers.nextDelay(), 30_000);
    timers.runNext();
    await flushPromises();
    assert.equal(applied.length, 1);
    assert.deepEqual(reports[1]?.evidence.clicks, []);
    sensor.dispose();
  });

  it("lets gate-core reject out-of-order stale report decisions", async () => {
    const { window, document } = browser();
    const timers = new Timers();
    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    const responses = [firstResponse, secondResponse];
    const applicationResults: boolean[] = [];
    const rejectionReasons: string[] = [];
    let controller!: ReturnType<typeof createGateController>;
    const sensor = createContinuousBrowserSensor({
      window,
      document,
      gateSessionId: SESSION_ID,
      sensorVersion: "sensor-1.0.0",
      startingSequence: 10,
      now: () => NOW,
      setTimer: timers.set,
      clearTimer: timers.clear,
      sendReport: async () => responses.shift()!.promise,
      applyDecisionRevision: async (candidate) => {
        const result = await controller.applyDecisionRevision(candidate);
        applicationResults.push(result);
        return result;
      },
    });
    controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: async () => decision(9),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
      setTimer: () => 1,
      clearTimer() {},
      onEffect: (effect) => {
        sensor.handleGateEffect(effect);
        if (effect.type === "decision_rejected") rejectionReasons.push(effect.reason);
      },
    });

    controller.start();
    await flushPromises();
    timers.runNext();
    sensor.recordNavigation("/next");
    secondResponse.resolve(decision(11));
    await flushPromises();
    firstResponse.resolve(decision(10));
    await flushPromises();

    assert.deepEqual(applicationResults, [true, false]);
    assert.deepEqual(rejectionReasons, ["stale"]);
    assert.equal(controller.getSnapshot().lastApplied?.sequence, 11);
    sensor.dispose();
    controller.dispose();
  });
});
