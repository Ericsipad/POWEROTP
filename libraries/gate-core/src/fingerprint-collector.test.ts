import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fingerprintComponentNames } from "@powerotp/contracts";
import { createFingerprintCollector } from "./fingerprint-collector.js";

type RawTestComponent =
  | { value: unknown; duration?: number }
  | { error: unknown; duration?: number };

function rawComponents(): Record<string, RawTestComponent> {
  return Object.fromEntries(
    fingerprintComponentNames.map((name) => [
      name,
      { error: new Error(`raw ${name} secret`), duration: 123 },
    ]),
  );
}

describe("fingerprint collector", () => {
  it("disables monitoring and collects only once for a gate session", async () => {
    let loads = 0;
    let gets = 0;
    const loadOptions: unknown[] = [];
    const scope = {};
    const collector = createFingerprintCollector({
      scope,
      loadAgent: async (options) => {
        loads += 1;
        loadOptions.push(options);
        return {
          async get() {
            gets += 1;
            return {
              visitorId: "discarded",
              confidence: { score: 1, comment: "discarded" },
              components: rawComponents(),
            };
          },
        };
      },
    });

    const first = await collector.collect("gate_session_123456789");
    const retry = await collector.collect("gate_session_123456789");
    const rerenderCollector = createFingerprintCollector({
      scope,
      loadAgent: async () => {
        throw new Error("must use the scoped cache");
      },
    });
    const rerender = await rerenderCollector.collect("gate_session_123456789");

    assert.equal(first, retry);
    assert.equal(first, rerender);
    assert.equal(loads, 1);
    assert.equal(gets, 1);
    assert.deepEqual(loadOptions, [{ monitoring: false }]);
    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes("visitorId"), false);
    assert.equal(serialized.includes("confidence"), false);
    assert.equal(serialized.includes("duration"), false);
    assert.equal(serialized.includes("raw audio secret"), false);
  });

  it("collects again for a newly created gate session", async () => {
    let gets = 0;
    const collector = createFingerprintCollector({
      scope: {},
      loadAgent: async () => ({
        async get() {
          gets += 1;
          return { components: rawComponents() };
        },
      }),
    });
    await collector.collect("gate_session_first_123");
    await collector.collect("gate_session_second_12");
    assert.equal(gets, 2);
  });

  it("maps v5.2.0 values and special statuses into the closed contract", async () => {
    const components = rawComponents();
    Object.assign(components, {
      osCpu: { value: "Windows NT 10.0", duration: 1 },
      screenResolution: { value: [1920, 1080], duration: 1 },
      platform: { value: "Win32", duration: 1 },
      touchSupport: {
        value: { maxTouchPoints: 5, touchEvent: true, touchStart: true },
        duration: 1,
      },
      vendor: { value: "Google Inc.", duration: 1 },
      architecture: { value: 255, duration: 1 },
      applePay: { value: -1, duration: 1 },
      audio: { value: -4, duration: 1 },
      canvas: {
        value: { winding: true, geometry: "skipped", text: "skipped" },
        duration: 1,
      },
      webGlBasics: { value: -1, duration: 1 },
      webGlExtensions: { value: -2, duration: 1 },
      dateTimeLocale: { value: -3, duration: 1 },
      fonts: { value: ["Arial"], duration: 1 },
      userAgentData: {
        value: {
          brands: ["Chromium"],
          mobile: false,
          platform: "Windows",
          architecture: "x86",
          bitness: "64",
          model: "",
        },
        duration: 1,
      },
    });
    const collector = createFingerprintCollector({
      scope: {},
      loadAgent: async () => ({ get: async () => ({ components }) }),
    });

    const result = await collector.collect("gate_session_values_123");
    assert.deepEqual(result.components.screenResolution, {
      status: "available",
      value: { width: 1920, height: 1080 },
    });
    assert.deepEqual(result.components.touchSupport, {
      status: "available",
      value: { maxTouchPoints: 5, touchEvent: true, touchStart: true },
    });
    assert.equal(result.components.audio?.status, "unstable");
    assert.equal(result.components.canvas?.status, "skipped");
    assert.equal(result.components.webGlBasics?.status, "unsupported");
    assert.equal(result.components.webGlExtensions?.status, "blocked");
    assert.equal(result.components.dateTimeLocale?.status, "unavailable");
  });

  it("omits components whose data is missing", async () => {
    const components = rawComponents();
    delete components.fonts;
    components.osCpu = { value: undefined };
    const collector = createFingerprintCollector({
      scope: {},
      loadAgent: async () => ({ get: async () => ({ components }) }),
    });
    const result = await collector.collect("gate_session_missing_123");
    assert.equal("fonts" in result.components, false);
    assert.equal("osCpu" in result.components, false);
  });

  it("maps loader failure to bounded errors without throwing", async () => {
    const collector = createFingerprintCollector({
      scope: {},
      loadAgent: async () => {
        throw Object.assign(new Error("bearer secret"), { stack: "secret stack" });
      },
    });
    const result = await collector.collect("gate_session_failure_12");
    assert.ok(
      Object.values(result.components).every(
        (component) =>
          component.status === "collector_error" &&
          component.code === "collection_failed",
      ),
    );
    assert.equal(JSON.stringify(result).includes("bearer secret"), false);
  });

  it("reduces an otherwise valid oversized result instead of blocking the session", async () => {
    const components = rawComponents();
    components.webGlExtensions = {
      value: {
        contextAttributes: [],
        parameters: Array(512).fill("x".repeat(200)),
        shaderPrecisions: [],
        extensions: [],
        extensionParameters: [],
        unsupportedExtensions: [],
      },
    };
    const collector = createFingerprintCollector({
      scope: {},
      loadAgent: async () => ({ get: async () => ({ components }) }),
    });
    const result = await collector.collect("gate_session_oversize_12");
    assert.equal(result.components.webGlExtensions?.status, "collector_error");
  });
});
