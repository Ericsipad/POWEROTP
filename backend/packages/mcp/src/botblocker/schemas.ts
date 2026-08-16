import { z } from "zod";

import type { BotBlockerAdapterId } from "./types.js";

/** Strict runtime contract for every MCP tool that returns a manifest. */
export const BotBlockerAdapterIdSchema = z.enum(["node-http", "express", "nextjs"]);

// Compile-time proof the schema's literal union stays in sync with the source type.
const _adapterIdShapeCheck: BotBlockerAdapterId = "node-http" as z.infer<
  typeof BotBlockerAdapterIdSchema
>;
void _adapterIdShapeCheck;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex SHA-256");

const ManifestFileSchema = z
  .object({
    path: z.string().min(1),
    contents: z.string().min(1),
    note: z.string().min(1),
    checksumSha256: Sha256HexSchema,
  })
  .strict();

const TroubleshootingEntrySchema = z
  .object({
    symptom: z.string().min(1),
    explanation: z.string().min(1),
  })
  .strict();

export const AdapterManifestSchema = z
  .object({
    adapter: BotBlockerAdapterIdSchema,
    displayName: z.string().min(1),
    packageName: z.string().startsWith("@powerotp/"),
    packageVersion: z.string().min(1),
    manifestFormatVersion: z.number().int().positive(),
    files: z.array(ManifestFileSchema).min(1),
    placementSteps: z.array(z.string().min(1)).min(1),
    testCommands: z.array(z.string().min(1)).min(1),
    exclusions: z.array(z.string().min(1)).min(1),
    knownLimitations: z.array(z.string().min(1)).min(1),
    troubleshooting: z.array(TroubleshootingEntrySchema).min(1),
    upgradeInstructions: z.array(z.string().min(1)).min(1),
    checksumSha256: Sha256HexSchema,
  })
  .strict();

export type ValidatedAdapterManifest = z.infer<typeof AdapterManifestSchema>;
