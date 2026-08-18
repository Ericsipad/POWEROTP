import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeBotBlockerArtifact,
  type FingerprintVector,
} from "@powerotp/contracts";

import {
  FINGERPRINT_VERIFY_LOOKUP_DOMAIN,
  deriveFingerprintVerifyLookup,
  projectFingerprintVerifySource,
} from "./botblocker-fingerprint-hash.js";

const secret = "fingerprint-hash-secret-at-least-32-characters";

function vector(): FingerprintVector {
  return {
    fingerprintVersion: 1,
    collectorVersion: "5.2.0",
    components: {
      userAgentData: {
        status: "available",
        value: {
          brands: ["Chromium 140.0.0", "Example Browser/140.2"],
          mobile: false,
          platform: "Windows 15.0.0",
          architecture: "x86",
          bitness: "64",
          model: "",
          platformVersion: "15.0.0",
        },
      },
      fonts: { status: "available", value: ["Arial", "Consolas"] },
      fontPreferences: {
        status: "available",
        value: {
          default: 120,
          apple: 121,
          serif: 122,
          sans: 123,
          mono: 124,
          min: 1,
          system: 125,
        },
      },
      audio: { status: "available", value: 124.043 },
      canvas: {
        status: "available",
        value: { winding: true, geometry: "canvas-geometry", text: "canvas-text" },
      },
      colorDepth: { status: "available", value: 24 },
      deviceMemory: { status: "available", value: 12 },
      screenResolution: {
        status: "available",
        value: { width: 1920, height: 1080 },
      },
      hardwareConcurrency: { status: "available", value: 8 },
      touchSupport: {
        status: "available",
        value: { maxTouchPoints: 0, touchEvent: false, touchStart: false },
      },
      vendor: { status: "available", value: "Google Inc." },
      colorGamut: { status: "available", value: "srgb" },
      architecture: { status: "available", value: 255 },
      audioBaseLatency: { status: "available", value: 0.01 },
      webGlBasics: {
        status: "available",
        value: {
          version: "WebGL 1.0",
          vendor: "WebKit",
          vendorUnmasked: "Google Inc.",
          renderer: "WebKit WebGL",
          rendererUnmasked: "ANGLE",
          shadingLanguageVersion: "WebGL GLSL ES 1.0",
        },
      },
      webGlExtensions: {
        status: "available",
        value: {
          contextAttributes: ["alpha=true"],
          parameters: ["MAX_TEXTURE_SIZE=16384"],
          shaderPrecisions: ["FRAGMENT_SHADER.LOW_FLOAT=127,127,23"],
          extensions: ["ANGLE_instanced_arrays"],
          extensionParameters: [],
          unsupportedExtensions: [],
        },
      },
    },
  };
}

function availableLookup(value: FingerprintVector, key = secret) {
  const result = deriveFingerprintVerifyLookup(
    projectFingerprintVerifySource(value),
    key,
  );
  assert.equal(result.status, "available");
  return result;
}

describe("user-intelligence verify lookup", () => {
  it("projects bounded row fields before producing one deterministic HMAC", () => {
    const source = projectFingerprintVerifySource(vector());
    const first = availableLookup(vector());
    const second = availableLookup(vector());
    const canonical = canonicalizeBotBlockerArtifact(source);

    assert.equal(FINGERPRINT_VERIFY_LOOKUP_DOMAIN, "powerotp.botblocker.verify-lookup.v1");
    assert.equal(first.hash, second.hash);
    assert.match(first.hash, /^[a-f0-9]{64}$/);
    assert.ok(canonical.includes('"deviceMemoryClass":8'));
    assert.ok(canonical.includes('"platformFamily":"windows"'));
    assert.ok(!canonical.includes("15.0.0"));
    assert.ok(!canonical.includes("140.0.0"));
  });

  it("includes every approved stable category", () => {
    const baseline = availableLookup(vector()).hash;
    const candidates: FingerprintVector[] = [
      withValue("hardwareConcurrency", 16),
      withValue("deviceMemory", 32),
      withValue("colorDepth", 30),
      withValue("colorGamut", "p3"),
      withValue("architecture", 127),
      withValue("audio", 125),
      withValue("audioBaseLatency", 0.02),
      withValue("vendor", "Other Vendor"),
    ];
    const canvas = vector();
    canvas.components.canvas = {
      status: "available",
      value: { winding: true, geometry: "changed", text: "canvas-text" },
    };
    candidates.push(canvas);
    const fonts = vector();
    fonts.components.fonts = { status: "available", value: ["Arial"] };
    candidates.push(fonts);
    const webGl = vector();
    webGl.components.webGlBasics = {
      status: "available",
      value: {
        ...webGl.components.webGlBasics!.value,
        rendererUnmasked: "Different GPU",
      },
    };
    candidates.push(webGl);

    for (const candidate of candidates) {
      assert.notEqual(availableLookup(candidate).hash, baseline);
    }
  });

  it("is invariant to excluded changing and privacy fields", () => {
    const baseline = availableLookup(vector()).hash;
    const changed = vector();
    changed.components.userAgentData = {
      status: "available",
      value: {
        ...changed.components.userAgentData!.value,
        brands: ["Chromium 999.0", "Example Browser/999.1"],
        platformVersion: "999.0",
      },
    };
    Object.assign(changed.components, {
      osCpu: { status: "available", value: "Windows NT 99.0" },
      timezone: { status: "available", value: "Pacific/Auckland" },
      languages: { status: "available", value: [["fr", "en"]] },
      screenFrame: {
        status: "available",
        value: { top: 99, right: 88, bottom: 77, left: 66 },
      },
      cookiesEnabled: { status: "available", value: false },
      localStorage: { status: "blocked" },
      indexedDB: { status: "unavailable" },
      reducedMotion: { status: "available", value: true },
      domBlockers: { status: "available", value: ["changed"] },
    });

    assert.equal(availableLookup(changed).hash, baseline);
  });

  it("stores partial row sources but never derives a partial hash", () => {
    const missing = vector();
    delete missing.components.canvas;
    const source = projectFingerprintVerifySource(missing);
    const unavailable = deriveFingerprintVerifyLookup(source, secret);

    assert.deepEqual(unavailable, {
      recipeVersion: 1,
      status: "unavailable",
      reason: "missing_stable_inputs",
    });
    assert.equal("canvas" in source, false);
  });

  it("separates the recipe domain and secret", () => {
    const first = availableLookup(vector()).hash;
    const second = availableLookup(
      vector(),
      "different-fingerprint-secret-at-least-32-characters",
    ).hash;
    assert.notEqual(first, second);
  });

  it("marks a complete persisted source unavailable when the key is absent", () => {
    assert.deepEqual(
      deriveFingerprintVerifyLookup(
        projectFingerprintVerifySource(vector()),
        undefined,
      ),
      {
        recipeVersion: 1,
        status: "unavailable",
        reason: "secret_unavailable",
      },
    );
  });
});

function withValue(
  name:
    | "hardwareConcurrency"
    | "deviceMemory"
    | "colorDepth"
    | "colorGamut"
    | "architecture"
    | "audio"
    | "audioBaseLatency"
    | "vendor",
  value: number | string,
): FingerprintVector {
  const changed = vector();
  (changed.components as Record<string, unknown>)[name] = {
    status: "available",
    value,
  };
  return changed;
}
