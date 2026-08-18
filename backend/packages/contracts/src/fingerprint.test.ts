import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINGERPRINT_COLLECTOR_VERSION,
  FINGERPRINT_VECTOR_MAX_BYTES,
  FINGERPRINT_VECTOR_VERSION,
  FingerprintComponentValueSchemas,
  FingerprintVectorSchema,
  fingerprintComponentNames,
} from "./index.js";

const math = Object.fromEntries(
  [
    "acos", "acosh", "acoshPf", "asin", "asinh", "asinhPf", "atanh",
    "atanhPf", "atan", "sin", "sinh", "sinhPf", "cos", "cosh",
    "coshPf", "tan", "tanh", "tanhPf", "exp", "expm1", "expm1Pf",
    "log1p", "log1pPf", "powPI",
  ].map((name) => [name, 0.5]),
);

const validValues = {
  userAgentData: {
    brands: ["Chromium"],
    mobile: false,
    platform: "Windows",
    architecture: "x86",
    bitness: "64",
    model: "",
    platformVersion: "15.0.0",
  },
  fonts: ["Arial"],
  domBlockers: ["adGuard"],
  fontPreferences: {
    default: 120, apple: 121, serif: 122, sans: 123, mono: 124, min: 1,
    system: 125,
  },
  audio: 124.043,
  screenFrame: { top: 0, right: 0, bottom: 40, left: 0 },
  canvas: { winding: true, geometry: "data:image/png;base64,AA", text: "AA" },
  osCpu: "Windows NT 10.0; Win64; x64",
  languages: [["en-US", "en"]],
  colorDepth: 24,
  deviceMemory: 8,
  screenResolution: { width: 1920, height: 1080 },
  hardwareConcurrency: 8,
  timezone: "America/Denver",
  sessionStorage: true,
  localStorage: true,
  indexedDB: true,
  openDatabase: false,
  cpuClass: "x86",
  platform: "Win32",
  plugins: [{
    name: "PDF Viewer",
    description: "Portable Document Format",
    mimeTypes: [{ type: "application/pdf", suffixes: "pdf" }],
  }],
  touchSupport: { maxTouchPoints: 0, touchEvent: false, touchStart: false },
  vendor: "Google Inc.",
  vendorFlavors: ["chrome"],
  cookiesEnabled: true,
  colorGamut: "srgb",
  invertedColors: false,
  forcedColors: false,
  monochrome: 0,
  contrast: 0,
  reducedMotion: false,
  reducedTransparency: false,
  hdr: false,
  math,
  pdfViewerEnabled: true,
  architecture: 255,
  applePay: -1,
  privateClickMeasurement: "",
  audioBaseLatency: 0.01,
  dateTimeLocale: "en-US",
  webGlBasics: {
    version: "WebGL 1.0",
    vendor: "WebKit",
    vendorUnmasked: "Google Inc.",
    renderer: "WebKit WebGL",
    rendererUnmasked: "ANGLE",
    shadingLanguageVersion: "WebGL GLSL ES 1.0",
  },
  webGlExtensions: {
    contextAttributes: ["alpha=true"],
    parameters: ["MAX_TEXTURE_SIZE=3379=16384"],
    shaderPrecisions: ["FRAGMENT_SHADER.LOW_FLOAT=127,127,23"],
    extensions: ["ANGLE_instanced_arrays"],
    extensionParameters: [],
    unsupportedExtensions: [],
  },
} satisfies Record<keyof typeof FingerprintComponentValueSchemas, unknown>;

function vector() {
  return {
    fingerprintVersion: FINGERPRINT_VECTOR_VERSION,
    collectorVersion: FINGERPRINT_COLLECTOR_VERSION,
    components: Object.fromEntries(
      fingerprintComponentNames.map((name) => [
        name,
        { status: "available", value: validValues[name] },
      ]),
    ),
  };
}

describe("fingerprint vector contract", () => {
  it("parses one complete valid v5.2.0 vector", () => {
    const parsed = FingerprintVectorSchema.parse(vector());
    assert.equal(Object.keys(parsed.components).length, 42);
    assert.deepEqual(parsed.components.screenResolution, {
      status: "available",
      value: { width: 1920, height: 1080 },
    });
  });

  it("requires every bounded component and rejects unknown component fields", () => {
    for (const name of fingerprintComponentNames) {
      assert.equal(
        FingerprintComponentValueSchemas[name].safeParse(undefined).success,
        false,
        `${name} must have a bounded value`,
      );
      const candidate = vector();
      (candidate.components[name] as Record<string, unknown>).unexpected = true;
      assert.equal(
        FingerprintVectorSchema.safeParse(candidate).success,
        false,
        `${name} wrapper must be closed`,
      );
    }
    const missing = vector();
    delete (missing.components as Record<string, unknown>).fonts;
    assert.equal(FingerprintVectorSchema.safeParse(missing).success, false);
    assert.equal(FingerprintVectorSchema.safeParse({
      ...vector(),
      components: { ...vector().components, arbitraryProbe: { status: "unavailable" } },
    }).success, false);
  });

  it("parses each deterministic unavailable state", () => {
    for (const state of [
      { status: "unavailable" },
      { status: "blocked" },
      { status: "skipped" },
      { status: "unstable" },
      { status: "unsupported" },
      { status: "collector_error", code: "collection_failed" },
    ]) {
      const candidate = vector();
      (candidate.components as Record<string, unknown>).audio = state;
      assert.equal(FingerprintVectorSchema.safeParse(candidate).success, true);
    }
  });

  it("rejects non-finite, unsafe, out-of-range, and unbounded values", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      assert.equal(FingerprintComponentValueSchemas.audio.safeParse(value).success, false);
    }
    assert.equal(
      FingerprintComponentValueSchemas.hardwareConcurrency.safeParse(
        Number.MAX_SAFE_INTEGER + 1,
      ).success,
      false,
    );
    assert.equal(FingerprintComponentValueSchemas.colorDepth.safeParse(129).success, false);
    assert.equal(
      FingerprintComponentValueSchemas.platform.safeParse("x".repeat(257)).success,
      false,
    );
    assert.equal(
      FingerprintComponentValueSchemas.fonts.safeParse(Array(257).fill("font")).success,
      false,
    );
    assert.equal(
      FingerprintComponentValueSchemas.touchSupport.safeParse({
        ...validValues.touchSupport,
        arbitrary: true,
      }).success,
      false,
    );
    assert.equal(
      FingerprintComponentValueSchemas.plugins.safeParse([{
        ...validValues.plugins[0],
        mimeTypes: Array(33).fill({ type: "x", suffixes: "" }),
      }]).success,
      false,
    );
  });

  it("rejects a total payload that exceeds the cap while fields remain valid", () => {
    const candidate = vector();
    candidate.components.webGlExtensions = {
      status: "available",
      value: {
        ...validValues.webGlExtensions,
        parameters: Array(512).fill("x".repeat(200)),
      },
    };
    assert.ok(JSON.stringify(candidate).length > FINGERPRINT_VECTOR_MAX_BYTES);
    assert.equal(FingerprintVectorSchema.safeParse(candidate).success, false);
  });

  it("rejects browser authority, raw errors, prohibited data, and credentials", () => {
    for (const field of [
      "visitorId", "confidence", "componentHash", "stableFingerprintHash",
      "error", "pageContent", "domSnapshot", "formValue", "password", "email",
      "rawKeystrokes", "clickedText", "pointerTrail", "cookies", "authorization",
      "visitorToken", "apiKey", "url", "query", "fragment",
    ]) {
      assert.equal(
        FingerprintVectorSchema.safeParse({ ...vector(), [field]: "secret" }).success,
        false,
        field,
      );
    }
  });
});
