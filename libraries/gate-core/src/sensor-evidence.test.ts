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
    accumulator.recordClick({ x: 10, y: 20 }, button as unknown as EventTarget, true);
    const snapshot = accumulator.snapshot("/checkout?secret=value");

    assert.deepEqual(snapshot.clicks, [
      { category: "button", powerOtpId: "checkout-submit" },
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
    accumulator.recordClick({ x: 0, y: 0 }, null, true);
    accumulator.recordPointer({ x: 3, y: 4 }, true);
    accumulator.recordClick({ x: 6, y: 8 }, null, true);
    accumulator.recordScroll(0, 1, true);
    accumulator.recordScroll(10, 11, true);
    accumulator.recordScroll(30, 21, true);
    accumulator.recordScroll(100, 31, true);

    const snapshot = accumulator.snapshot("/products");
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
    assert.equal(JSON.stringify(snapshot).includes('"x"'), false);
    assert.equal(JSON.stringify(snapshot).includes('"position"'), false);
  });

  it("emits only the fixed automation indicator enum", () => {
    const accumulator = createSensorEvidenceAccumulator({
      sensorVersion: "sensor-1.0.0",
      webdriver: true,
    });
    accumulator.recordPointer({ x: 1, y: 1 }, false);
    accumulator.recordClick({ x: 1, y: 1 }, null, false);
    accumulator.recordScroll(1, 1, false);

    assert.deepEqual(accumulator.snapshot("/").environment, {
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
    accumulator.recordClick({ x: 0, y: 0 }, element as unknown as EventTarget, true);

    const snapshot = accumulator.snapshot("/");
    assert.deepEqual(snapshot.clicks, [{ category: "link" }]);
    assert.deepEqual(snapshot.honeypotActivations, []);
  });
});
