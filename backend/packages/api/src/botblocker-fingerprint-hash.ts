import { createHmac } from "node:crypto";

import {
  FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION,
  canonicalizeBotBlockerArtifact,
  type FingerprintVerifyLookup,
  type FingerprintVerifySource,
  type FingerprintVector,
} from "@powerotp/contracts";

export const FINGERPRINT_VERIFY_LOOKUP_DOMAIN =
  `powerotp.botblocker.verify-lookup.v${FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION}`;

const requiredSourceFields = [
  "platformFamily",
  "cpu",
  "hardwareConcurrency",
  "deviceMemoryClass",
  "maximumTouchPoints",
  "display",
  "webGl",
  "canvas",
  "audio",
  "fonts",
  "fontPreferences",
  "browser",
] as const satisfies readonly (keyof FingerprintVerifySource)[];

export function projectFingerprintVerifySource(
  vector: FingerprintVector,
): FingerprintVerifySource {
  const components = vector.components;
  const userAgentData = available(components.userAgentData);
  const architecture = available(components.architecture);
  const hardwareConcurrency = available(components.hardwareConcurrency);
  const deviceMemory = available(components.deviceMemory);
  const touchSupport = available(components.touchSupport);
  const screenResolution = available(components.screenResolution);
  const colorDepth = available(components.colorDepth);
  const colorGamut = available(components.colorGamut);
  const webGlBasics = available(components.webGlBasics);
  const webGlExtensions = available(components.webGlExtensions);
  const canvas = available(components.canvas);
  const audio = available(components.audio);
  const audioBaseLatency = available(components.audioBaseLatency);
  const fonts = available(components.fonts);
  const fontPreferences = available(components.fontPreferences);
  const vendor = available(components.vendor);
  const source: FingerprintVerifySource = {};

  if (userAgentData) {
    source.platformFamily = platformFamily(userAgentData.platform);
    if (userAgentData.model?.trim()) {
      source.mobileModel = normalizeText(userAgentData.model);
    }
  }
  if (
    userAgentData?.architecture &&
    userAgentData.bitness &&
    architecture !== undefined
  ) {
    source.cpu = {
      architecture: normalizeText(userAgentData.architecture),
      bitness: normalizeText(userAgentData.bitness),
      fingerprintArchitecture: architecture,
    };
  }
  if (hardwareConcurrency !== undefined) {
    source.hardwareConcurrency = hardwareConcurrency;
  }
  if (deviceMemory !== undefined) {
    source.deviceMemoryClass = coarsenDeviceMemory(deviceMemory);
  }
  if (touchSupport) source.maximumTouchPoints = touchSupport.maxTouchPoints;
  if (
    screenResolution?.width !== null &&
    screenResolution?.width !== undefined &&
    screenResolution.height !== null &&
    screenResolution.height !== undefined &&
    colorDepth !== undefined &&
    colorGamut !== undefined
  ) {
    source.display = {
      shorterSide: Math.min(screenResolution.width, screenResolution.height),
      longerSide: Math.max(screenResolution.width, screenResolution.height),
      colorDepth,
      colorGamut,
    };
  }
  if (webGlBasics && webGlExtensions) {
    source.webGl = {
      basics: normalizedRecord(webGlBasics),
      contextAttributes: sorted(webGlExtensions.contextAttributes),
      parameters: sorted(webGlExtensions.parameters),
      shaderPrecisions: sorted(webGlExtensions.shaderPrecisions),
      extensions: webGlExtensions.extensions
        ? sorted(webGlExtensions.extensions)
        : null,
      extensionParameters: sorted(webGlExtensions.extensionParameters),
      unsupportedExtensions: sorted(webGlExtensions.unsupportedExtensions),
    };
  }
  if (canvas) source.canvas = canvas;
  if (audio !== undefined && audioBaseLatency !== undefined) {
    source.audio = { value: audio, baseLatency: audioBaseLatency };
  }
  if (fonts) source.fonts = sorted(fonts);
  if (fontPreferences) source.fontPreferences = fontPreferences;
  if (userAgentData && vendor !== undefined) {
    source.browser = {
      vendor: normalizeText(vendor),
      families: sorted(
        userAgentData.brands
          .map(browserFamily)
          .filter((value) => value.length > 0),
      ),
    };
  }
  return source;
}

export function deriveFingerprintVerifyLookup(
  source: FingerprintVerifySource,
  secret: string | undefined,
): FingerprintVerifyLookup {
  if (requiredSourceFields.some((name) => source[name] === undefined)) {
    return {
      recipeVersion: FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION,
      status: "unavailable",
      reason: "missing_stable_inputs",
    };
  }
  if (!secret) {
    return {
      recipeVersion: FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION,
      status: "unavailable",
      reason: "secret_unavailable",
    };
  }
  const canonical = canonicalizeBotBlockerArtifact(source);
  return {
    recipeVersion: FINGERPRINT_VERIFY_LOOKUP_RECIPE_VERSION,
    status: "available",
    hash: createHmac("sha256", secret)
      .update(`${FINGERPRINT_VERIFY_LOOKUP_DOMAIN}\0${canonical}`)
      .digest("hex"),
  };
}

function available<T>(
  component: { status: "available"; value: T } | { status: string } | undefined,
): T | undefined {
  return component?.status === "available" && "value" in component
    ? component.value
    : undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function browserFamily(value: string): string {
  return normalizeText(value)
    .replace(/[\/\s_-]+v?\d+(?:\.\d+)*.*$/i, "")
    .trim();
}

function platformFamily(value: string): string {
  const normalized = normalizeText(value);
  if (/windows|win32/.test(normalized)) return "windows";
  if (/android/.test(normalized)) return "android";
  if (/iphone|ipad|ios/.test(normalized)) return "ios";
  if (/mac|darwin/.test(normalized)) return "macos";
  if (/chrome ?os|cros/.test(normalized)) return "chromeos";
  if (/linux/.test(normalized)) return "linux";
  return normalized.replace(/[\s_-]*\d+(?:\.\d+)*.*$/, "");
}

function coarsenDeviceMemory(value: number): number {
  if (value <= 0) return 0;
  const exponent = Math.floor(Math.log2(value));
  return Math.min(1_024, 2 ** exponent);
}

function sorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeText))].sort();
}

function normalizedRecord<T extends Record<string, string>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeText(item)]),
  ) as T;
}
