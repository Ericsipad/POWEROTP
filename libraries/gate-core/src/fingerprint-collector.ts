import FingerprintJS from "@fingerprintjs/fingerprintjs";
import {
  FINGERPRINT_COLLECTOR_VERSION,
  FINGERPRINT_VECTOR_VERSION,
  FingerprintComponentValueSchemas,
  FingerprintVectorSchema,
  fingerprintComponentNames,
  type FingerprintUnavailableStatus,
  type FingerprintVector,
} from "@powerotp/contracts/browser";

type RawComponent = { value: unknown; duration?: unknown } | {
  error: unknown;
  duration?: unknown;
};
type FingerprintAgent = {
  get(): Promise<{ components: Record<string, RawComponent> }>;
};
type AgentLoader = (options: { monitoring: false }) => Promise<FingerprintAgent>;

export interface FingerprintCollectorOptions {
  /** Cache scope, normally the current Window. */
  scope: object;
  loadAgent?: AgentLoader;
}

export interface FingerprintCollector {
  collect(gateSessionId: string): Promise<FingerprintVector>;
}

const scopedCollections = new WeakMap<
  object,
  Map<string, Promise<FingerprintVector>>
>();

export function createFingerprintCollector(
  options: FingerprintCollectorOptions,
): FingerprintCollector {
  const loadAgent: AgentLoader =
    options.loadAgent ??
    ((loadOptions) => FingerprintJS.load(loadOptions) as Promise<FingerprintAgent>);
  let sessions = scopedCollections.get(options.scope);
  if (!sessions) {
    sessions = new Map();
    scopedCollections.set(options.scope, sessions);
  }

  return {
    collect(gateSessionId) {
      if (
        typeof gateSessionId !== "string" ||
        gateSessionId.length < 16 ||
        gateSessionId.length > 128
      ) {
        throw new TypeError("Gate session ID must contain 16 through 128 characters");
      }
      const existing = sessions!.get(gateSessionId);
      if (existing) return existing;
      const collection = collectVector(loadAgent);
      sessions!.set(gateSessionId, collection);
      return collection;
    },
  };
}

async function collectVector(loadAgent: AgentLoader): Promise<FingerprintVector> {
  let raw: Record<string, RawComponent>;
  try {
    const agent = await loadAgent({ monitoring: false });
    raw = (await agent.get()).components;
  } catch {
    return errorVector();
  }

  const components: Record<string, unknown> = {};
  for (const name of fingerprintComponentNames) {
    const component = mapComponent(name, raw[name]);
    if (component !== undefined) components[name] = component;
  }
  const parsed = FingerprintVectorSchema.safeParse({
    fingerprintVersion: FINGERPRINT_VECTOR_VERSION,
    collectorVersion: FINGERPRINT_COLLECTOR_VERSION,
    components,
  });
  return parsed.success ? parsed.data : errorVector();
}

function mapComponent(
  name: keyof typeof FingerprintComponentValueSchemas,
  component: RawComponent | undefined,
): unknown {
  if (!component) return undefined;
  if ("error" in component) return mapError(component.error);
  const mapped = mapSpecialValue(name, component.value);
  if (mapped === undefined) return undefined;
  if (isUnavailable(mapped)) return { status: mapped };
  const parsed = FingerprintComponentValueSchemas[name].safeParse(mapped);
  return parsed.success
    ? { status: "available", value: parsed.data }
    : collectorError();
}

function mapSpecialValue(
  name: keyof typeof FingerprintComponentValueSchemas,
  value: unknown,
): unknown | FingerprintUnavailableStatus {
  if (value === undefined) return undefined;
  if (name === "audio" && typeof value === "number") {
    if (value === -1) return "skipped";
    if (value === -2) return "unsupported";
    if (value === -3) return "unavailable";
    if (value === -4) return "unstable";
  }
  if (name === "canvas" && isRecord(value)) {
    for (const status of ["unsupported", "skipped", "unstable"] as const) {
      if (value.geometry === status || value.text === status) return status;
    }
  }
  if ((name === "webGlBasics" || name === "webGlExtensions")) {
    if (value === -1) return "unsupported";
    if (value === -2) return "blocked";
  }
  if (name === "dateTimeLocale") {
    if (value === -1 || value === -2) return "unsupported";
    if (value === -3) return "unavailable";
  }
  if (name === "screenFrame" && Array.isArray(value) && value.length === 4) {
    return {
      top: value[0],
      right: value[1],
      bottom: value[2],
      left: value[3],
    };
  }
  if (name === "screenResolution" && Array.isArray(value) && value.length === 2) {
    return { width: value[0], height: value[1] };
  }
  return value;
}

function mapError(error: unknown): unknown {
  const name = isRecord(error) && typeof error.name === "string"
    ? error.name
    : undefined;
  return name === "NotAllowedError" || name === "SecurityError"
    ? { status: "blocked" }
    : collectorError();
}

function errorVector(): FingerprintVector {
  const components = Object.fromEntries(
    fingerprintComponentNames.map((name) => [name, collectorError()]),
  );
  return FingerprintVectorSchema.parse({
    fingerprintVersion: FINGERPRINT_VECTOR_VERSION,
    collectorVersion: FINGERPRINT_COLLECTOR_VERSION,
    components,
  });
}

function collectorError() {
  return { status: "collector_error" as const, code: "collection_failed" as const };
}

function isUnavailable(value: unknown): value is FingerprintUnavailableStatus {
  return (
    value === "unavailable" ||
    value === "blocked" ||
    value === "skipped" ||
    value === "unstable" ||
    value === "unsupported"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
