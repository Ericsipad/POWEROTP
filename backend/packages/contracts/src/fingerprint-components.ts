import { z } from "zod";

const finite = (min = -1_000_000_000, max = 1_000_000_000) =>
  z.number().min(min).max(max);
const integer = (min: number, max: number) => z.number().int().min(min).max(max);
const text = (max: number) =>
  z.string().max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Control characters are not allowed",
  });
const textArray = (items: number, itemLength = 512) =>
  z.array(text(itemLength)).max(items);

const UserAgentDataSchema = z
  .object({
    brands: textArray(32, 128),
    mobile: z.boolean(),
    platform: text(128),
    architecture: text(64).optional(),
    bitness: text(32).optional(),
    model: text(256).optional(),
    platformVersion: text(128).optional(),
    highEntropyStatus: z.literal("not_allowed").optional(),
  })
  .strict();

const FontPreferencesSchema = z
  .object({
    default: finite(0, 1_000_000),
    apple: finite(0, 1_000_000),
    serif: finite(0, 1_000_000),
    sans: finite(0, 1_000_000),
    mono: finite(0, 1_000_000),
    min: finite(0, 1_000_000),
    system: finite(0, 1_000_000),
  })
  .strict();

const ScreenFrameSchema = z
  .object({
    top: finite(-1_000_000, 1_000_000).nullable(),
    right: finite(-1_000_000, 1_000_000).nullable(),
    bottom: finite(-1_000_000, 1_000_000).nullable(),
    left: finite(-1_000_000, 1_000_000).nullable(),
  })
  .strict();

const CanvasSchema = z
  .object({
    winding: z.boolean(),
    geometry: text(24_000),
    text: text(24_000),
  })
  .strict();

const ScreenResolutionSchema = z
  .object({
    width: integer(0, 1_000_000).nullable(),
    height: integer(0, 1_000_000).nullable(),
  })
  .strict();

const PluginSchema = z
  .object({
    name: text(256),
    description: text(1_024),
    mimeTypes: z
      .array(
        z.object({ type: text(256), suffixes: text(512) }).strict(),
      )
      .max(32),
  })
  .strict();

const TouchSupportSchema = z
  .object({
    maxTouchPoints: integer(0, 1_024),
    touchEvent: z.boolean(),
    touchStart: z.boolean(),
  })
  .strict();

const MathSchema = z
  .object({
    acos: finite(),
    acosh: finite(),
    acoshPf: finite(),
    asin: finite(),
    asinh: finite(),
    asinhPf: finite(),
    atanh: finite(),
    atanhPf: finite(),
    atan: finite(),
    sin: finite(),
    sinh: finite(),
    sinhPf: finite(),
    cos: finite(),
    cosh: finite(),
    coshPf: finite(),
    tan: finite(),
    tanh: finite(),
    tanhPf: finite(),
    exp: finite(),
    expm1: finite(),
    expm1Pf: finite(),
    log1p: finite(),
    log1pPf: finite(),
    powPI: finite(),
  })
  .strict();

const WebGlBasicsSchema = z
  .object({
    version: text(512),
    vendor: text(512),
    vendorUnmasked: text(512),
    renderer: text(1_024),
    rendererUnmasked: text(1_024),
    shadingLanguageVersion: text(512),
  })
  .strict();

const WebGlExtensionsSchema = z
  .object({
    contextAttributes: textArray(64),
    parameters: textArray(512),
    shaderPrecisions: textArray(32),
    extensions: textArray(512).nullable(),
    extensionParameters: textArray(512),
    unsupportedExtensions: textArray(512),
  })
  .strict();

export const FingerprintComponentValueSchemas = {
  userAgentData: UserAgentDataSchema,
  fonts: textArray(256, 256),
  domBlockers: textArray(128, 256),
  fontPreferences: FontPreferencesSchema,
  audio: finite(-1_000_000, 1_000_000),
  screenFrame: ScreenFrameSchema,
  canvas: CanvasSchema,
  osCpu: text(256),
  languages: z.array(textArray(16, 128)).max(16),
  colorDepth: integer(0, 128),
  deviceMemory: finite(0, 1_024),
  screenResolution: ScreenResolutionSchema,
  hardwareConcurrency: integer(0, 1_024),
  timezone: text(128),
  sessionStorage: z.boolean(),
  localStorage: z.boolean(),
  indexedDB: z.boolean(),
  openDatabase: z.boolean(),
  cpuClass: text(128),
  platform: text(256),
  plugins: z.array(PluginSchema).max(64),
  touchSupport: TouchSupportSchema,
  vendor: text(256),
  vendorFlavors: textArray(64, 128),
  cookiesEnabled: z.boolean(),
  colorGamut: z.enum(["srgb", "p3", "rec2020"]),
  invertedColors: z.boolean(),
  forcedColors: z.boolean(),
  monochrome: integer(0, 128),
  contrast: integer(-1, 1),
  reducedMotion: z.boolean(),
  reducedTransparency: z.boolean(),
  hdr: z.boolean(),
  math: MathSchema,
  pdfViewerEnabled: z.boolean(),
  architecture: integer(-1_024, 1_024),
  applePay: z.union([
    z.literal(-3),
    z.literal(-2),
    z.literal(-1),
    z.literal(0),
    z.literal(1),
  ]),
  privateClickMeasurement: text(256),
  audioBaseLatency: finite(0, 1_000),
  dateTimeLocale: text(128),
  webGlBasics: WebGlBasicsSchema,
  webGlExtensions: WebGlExtensionsSchema,
} as const;

export const fingerprintComponentNames = Object.keys(
  FingerprintComponentValueSchemas,
) as Array<keyof typeof FingerprintComponentValueSchemas>;
