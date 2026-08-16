import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Window } from "happy-dom";
import {
  createSensorEvidenceAccumulator,
  sanitizeRoutePath,
} from "./sensor-evidence.js";

describe("sensor evidence sanitization", () => {
  it("strips query and fragment without retaining full URLs", () => {
    assert.equal(sanitizeRoutePath("/checkout?token=secret#payment"), "/checkout");
    assert.equal(sanitizeRoutePath("/orders#latest"), "/orders");
    assert.equal(sanitizeRoutePath("https://attacker.example/private"), "/");
    assert.equal(sanitizeRoutePath("/unsafe\\path"), "/");
    assert.equal(sanitizeRoutePath(null), "/");
  });

  it("emits only sanitized click categories and explicit safe IDs", () => {
    const window = new Window();
    const document = window.document;
    const button = document.createElement("button");
    button.textContent = "Secret clicked text";
    button.setAttribute("value", "secret form value");
    button.setAttribute("data-powerotp-id", "checkout-submit");
    document.body.append(button);

    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: false,
    });
    accumulator.recordClick(
      { x: 10, y: 20 },
      { width: 100, height: 200 },
      button as unknown as EventTarget,
      true,
    );
    const snapshot = accumulator.snapshot(
      "/checkout?secret=value",
      { width: 100, height: 200 },
    );

    assert.deepEqual(snapshot.clicks, [
      {
        category: "button",
        powerOtpId: "checkout-submit",
        position: { xRatio: 0.1, yRatio: 0.1 },
      },
    ]);
    assert.equal(snapshot.routePath, "/checkout");
    assert.equal(JSON.stringify(snapshot).includes("Secret clicked text"), false);
    assert.equal(JSON.stringify(snapshot).includes("secret form value"), false);
  });

  it("computes directness and scroll aggregates without emitting trails", () => {
    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: false,
    });
    const dimensions = { width: 100, height: 100 };
    accumulator.recordClick({ x: 0, y: 0 }, dimensions, null, true);
    accumulator.recordPointer({ x: 3, y: 4 }, dimensions, 1, true);
    accumulator.recordClick({ x: 6, y: 8 }, dimensions, null, true);
    accumulator.recordScroll(0, 1, true);
    accumulator.recordScroll(10, 11, true);
    accumulator.recordScroll(30, 21, true);
    accumulator.recordScroll(100, 31, true);

    const snapshot = accumulator.snapshot("/products", dimensions);
    assert.deepEqual(snapshot.mouseDirectness, {
      averageDirectnessRatio: 1,
      sampleCount: 1,
    });
    assert.deepEqual(snapshot.scroll, {
      smoothnessScore: 0.392857,
      highSpeedEventCount: 1,
    });
    assert.equal("mouseTrail" in snapshot, false);
    assert.equal("scrollTrail" in snapshot, false);
    assert.equal(JSON.stringify(snapshot).includes('"clientX"'), false);
    assert.equal(JSON.stringify(snapshot).includes('"pageX"'), false);
  });

  it("emits only the fixed automation indicator enum", () => {
    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: true,
    });
    const dimensions = { width: 100, height: 100 };
    accumulator.recordPointer({ x: 1, y: 1 }, dimensions, 1, false);
    accumulator.recordClick({ x: 1, y: 1 }, dimensions, null, false);
    accumulator.recordScroll(1, 1, false);

    assert.deepEqual(accumulator.snapshot("/", dimensions).environment, {
      evidenceVersion: 1,
      sensorVersion: "sensor-1.0.0",
      automationIndicators: [
        "webdriver",
        "untrusted_pointer",
        "untrusted_click",
        "untrusted_scroll",
      ],
    });
  });

  it("omits unsafe explicit IDs instead of truncating their contents", () => {
    const window = new Window();
    const element = window.document.createElement("a");
    element.setAttribute("data-powerotp-id", "not a safe identifier");
    element.setAttribute("data-powerotp-honeypot-id", "secret value with spaces");
    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: false,
    });
    accumulator.recordClick(
      { x: 0, y: 0 },
      { width: 100, height: 100 },
      element as unknown as EventTarget,
      true,
    );

    const snapshot = accumulator.snapshot("/", { width: 100, height: 100 });
    assert.deepEqual(snapshot.clicks, [{
      category: "link",
      position: { xRatio: 0, yRatio: 0 },
    }]);
    assert.deepEqual(snapshot.honeypotActivations, []);
  });

  it("emits bounded heatmap bins, explicit page metadata, timing, and navigation", () => {
    let current = 1_000;
    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: false,
      now: () => current,
    });
    const dimensions = { width: 1_000, height: 2_000 };
    accumulator.recordPointer({ x: 500, y: 1_000 }, dimensions, 1_000, true);
    accumulator.recordPointer({ x: 510, y: 1_010 }, dimensions, 1_100, true);
    current = 1_250;

    const snapshot = accumulator.snapshot(
      "/catalog",
      dimensions,
      {
        pageId: "catalog",
        pageName: "Product catalog",
        navigationTargetPath: "/checkout?secret=removed",
      },
      current,
    );

    assert.equal(snapshot.pageView?.pageId, "catalog");
    assert.equal(snapshot.pageView?.pageName, "Product catalog");
    assert.equal(snapshot.pageView?.durationMs, 250);
    assert.equal(snapshot.pageView?.activeDurationMs, 250);
    assert.equal(snapshot.pageView?.navigationTargetPath, "/checkout");
    assert.deepEqual(snapshot.pageView?.pointerHeatmap.bins, [{
      column: 16,
      row: 16,
      sampleCount: 2,
      dwellMs: 250,
    }]);
  });
});
