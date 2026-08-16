export type BotBlockerAdapterId = "node-http" | "express" | "nextjs";

export const BOTBLOCKER_ADAPTER_IDS: readonly BotBlockerAdapterId[] = [
  "node-http",
  "express",
  "nextjs",
];

export interface AdapterTemplateFile {
  /** Exact repository-relative placement path in the customer's project. */
  path: string;
  contents: string;
  /** Human-readable placement/ordering note shown alongside this file. */
  note: string;
}

export interface AdapterTemplate {
  adapter: BotBlockerAdapterId;
  displayName: string;
  packageName: string;
  /** Matches the corresponding `libraries/gate-*` package.json "version" field. */
  packageVersion: string;
  files: readonly AdapterTemplateFile[];
  placementSteps: readonly string[];
  testCommands: readonly string[];
  exclusions: readonly string[];
  knownLimitations: readonly string[];
  troubleshooting: readonly { symptom: string; explanation: string }[];
  upgradeInstructions: readonly string[];
}
