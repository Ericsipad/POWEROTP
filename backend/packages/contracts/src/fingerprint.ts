import { z } from "zod";

import { FingerprintComponentValueSchemas as values } from "./fingerprint-components.js";

export const FINGERPRINT_VECTOR_VERSION = 1;
export const FINGERPRINT_COLLECTOR_VERSION = "5.2.0";
export const FINGERPRINT_VECTOR_MAX_BYTES = 56 * 1_024;

export const fingerprintUnavailableStatuses = [
  "unavailable",
  "blocked",
  "skipped",
  "unstable",
  "unsupported",
] as const;

const UnavailableComponentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }).strict(),
  z.object({ status: z.literal("blocked") }).strict(),
  z.object({ status: z.literal("skipped") }).strict(),
  z.object({ status: z.literal("unstable") }).strict(),
  z.object({ status: z.literal("unsupported") }).strict(),
  z
    .object({
      status: z.literal("collector_error"),
      code: z.literal("collection_failed"),
    })
    .strict(),
]);

export function fingerprintComponentSchema<T extends z.ZodType>(value: T) {
  return z.union([
    z.object({ status: z.literal("available"), value }).strict(),
    UnavailableComponentSchema,
  ]);
}

export const FingerprintComponentsSchema = z
  .object({
    userAgentData: fingerprintComponentSchema(values.userAgentData),
    fonts: fingerprintComponentSchema(values.fonts),
    domBlockers: fingerprintComponentSchema(values.domBlockers),
    fontPreferences: fingerprintComponentSchema(values.fontPreferences),
    audio: fingerprintComponentSchema(values.audio),
    screenFrame: fingerprintComponentSchema(values.screenFrame),
    canvas: fingerprintComponentSchema(values.canvas),
    osCpu: fingerprintComponentSchema(values.osCpu),
    languages: fingerprintComponentSchema(values.languages),
    colorDepth: fingerprintComponentSchema(values.colorDepth),
    deviceMemory: fingerprintComponentSchema(values.deviceMemory),
    screenResolution: fingerprintComponentSchema(values.screenResolution),
    hardwareConcurrency: fingerprintComponentSchema(values.hardwareConcurrency),
    timezone: fingerprintComponentSchema(values.timezone),
    sessionStorage: fingerprintComponentSchema(values.sessionStorage),
    localStorage: fingerprintComponentSchema(values.localStorage),
    indexedDB: fingerprintComponentSchema(values.indexedDB),
    openDatabase: fingerprintComponentSchema(values.openDatabase),
    cpuClass: fingerprintComponentSchema(values.cpuClass),
    platform: fingerprintComponentSchema(values.platform),
    plugins: fingerprintComponentSchema(values.plugins),
    touchSupport: fingerprintComponentSchema(values.touchSupport),
    vendor: fingerprintComponentSchema(values.vendor),
    vendorFlavors: fingerprintComponentSchema(values.vendorFlavors),
    cookiesEnabled: fingerprintComponentSchema(values.cookiesEnabled),
    colorGamut: fingerprintComponentSchema(values.colorGamut),
    invertedColors: fingerprintComponentSchema(values.invertedColors),
    forcedColors: fingerprintComponentSchema(values.forcedColors),
    monochrome: fingerprintComponentSchema(values.monochrome),
    contrast: fingerprintComponentSchema(values.contrast),
    reducedMotion: fingerprintComponentSchema(values.reducedMotion),
    reducedTransparency: fingerprintComponentSchema(values.reducedTransparency),
    hdr: fingerprintComponentSchema(values.hdr),
    math: fingerprintComponentSchema(values.math),
    pdfViewerEnabled: fingerprintComponentSchema(values.pdfViewerEnabled),
    architecture: fingerprintComponentSchema(values.architecture),
    applePay: fingerprintComponentSchema(values.applePay),
    privateClickMeasurement: fingerprintComponentSchema(
      values.privateClickMeasurement,
    ),
    audioBaseLatency: fingerprintComponentSchema(values.audioBaseLatency),
    dateTimeLocale: fingerprintComponentSchema(values.dateTimeLocale),
    webGlBasics: fingerprintComponentSchema(values.webGlBasics),
    webGlExtensions: fingerprintComponentSchema(values.webGlExtensions),
  })
  .partial()
  .strict();

export const FingerprintVectorSchema = z
  .object({
    fingerprintVersion: z.literal(FINGERPRINT_VECTOR_VERSION),
    collectorVersion: z.literal(FINGERPRINT_COLLECTOR_VERSION),
    components: FingerprintComponentsSchema,
  })
  .strict()
  .superRefine((vector, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(vector)).byteLength >
      FINGERPRINT_VECTOR_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: `Fingerprint vector exceeds ${FINGERPRINT_VECTOR_MAX_BYTES} bytes`,
      });
    }
  });

export type FingerprintUnavailableStatus =
  (typeof fingerprintUnavailableStatuses)[number];
export type FingerprintComponents = z.infer<typeof FingerprintComponentsSchema>;
export type FingerprintVector = z.infer<typeof FingerprintVectorSchema>;
