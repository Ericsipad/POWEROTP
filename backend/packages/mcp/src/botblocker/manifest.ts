import { sha256Hex } from "./checksum.js";
import { buildExpressTemplate } from "./templates/express.js";
import { buildNextjsTemplate } from "./templates/nextjs.js";
import { buildNodeHttpTemplate } from "./templates/node-http.js";
import type { AdapterTemplate, BotBlockerAdapterId } from "./types.js";

export { BOTBLOCKER_ADAPTER_IDS } from "./types.js";
export type { BotBlockerAdapterId } from "./types.js";

/** Bump only when the manifest *shape* itself changes, independent of adapter package versions. */
export const MANIFEST_FORMAT_VERSION = 1;

/**
 * Matches each `libraries/gate-*` package.json "version" field. `manifest.test.ts`
 * asserts this stays in sync so a bumped wrapper version cannot silently ship a
 * stale manifest.
 */
const PACKAGE_VERSIONS: Record<BotBlockerAdapterId, string> = {
  "node-http": "0.1.0",
  express: "0.1.0",
  nextjs: "0.1.0",
};

export interface ManifestFile {
  path: string;
  contents: string;
  note: string;
  checksumSha256: string;
}

export interface AdapterManifest {
  adapter: BotBlockerAdapterId;
  displayName: string;
  packageName: string;
  packageVersion: string;
  manifestFormatVersion: number;
  files: ManifestFile[];
  placementSteps: readonly string[];
  testCommands: readonly string[];
  exclusions: readonly string[];
  knownLimitations: readonly string[];
  troubleshooting: readonly { symptom: string; explanation: string }[];
  upgradeInstructions: readonly string[];
  checksumSha256: string;
}

const BUILDERS: Record<BotBlockerAdapterId, (version: string) => AdapterTemplate> = {
  "node-http": buildNodeHttpTemplate,
  express: buildExpressTemplate,
  nextjs: buildNextjsTemplate,
};

export function buildBotBlockerManifest(adapter: BotBlockerAdapterId): AdapterManifest {
  const template = BUILDERS[adapter](PACKAGE_VERSIONS[adapter]);
  const files: ManifestFile[] = template.files.map((file) => ({
    path: file.path,
    contents: file.contents,
    note: file.note,
    checksumSha256: sha256Hex(file.contents),
  }));

  const canonical = [
    `adapter:${template.adapter}`,
    `package:${template.packageName}@${template.packageVersion}`,
    `format:${MANIFEST_FORMAT_VERSION}`,
    ...files.map((file) => `file:${file.path}:${file.checksumSha256}`),
  ].join("\n");

  return {
    adapter: template.adapter,
    displayName: template.displayName,
    packageName: template.packageName,
    packageVersion: template.packageVersion,
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    files,
    placementSteps: template.placementSteps,
    testCommands: template.testCommands,
    exclusions: template.exclusions,
    knownLimitations: template.knownLimitations,
    troubleshooting: template.troubleshooting,
    upgradeInstructions: template.upgradeInstructions,
    checksumSha256: sha256Hex(canonical),
  };
}

export function buildAllBotBlockerManifests(): Record<BotBlockerAdapterId, AdapterManifest> {
  return {
    "node-http": buildBotBlockerManifest("node-http"),
    express: buildBotBlockerManifest("express"),
    nextjs: buildBotBlockerManifest("nextjs"),
  };
}
