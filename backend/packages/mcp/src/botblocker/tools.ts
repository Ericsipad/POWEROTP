import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { getBotBlockerArchitectureOverview, getBotBlockerDataBoundary } from "./architecture.js";
import {
  BOTBLOCKER_ENV_VARS,
  BOTBLOCKER_PLANNED_ENV_VARS,
  BOTBLOCKER_UNDELIVERED_ENV_VARS,
} from "./env.js";
import { buildAllBotBlockerManifests, buildBotBlockerManifest } from "./manifest.js";
import { AdapterManifestSchema, BotBlockerAdapterIdSchema } from "./schemas.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Registers every public, anonymous, read-only, credential-free BotBlocker
 * MCP resource and tool. This adds documentation/generation capability only —
 * it never reads or returns customer data and never mutates anything.
 */
export function registerBotBlockerCapabilities(mcp: McpServer): void {
  mcp.registerResource(
    "botblocker-architecture-overview",
    "powerotp://botblocker/docs/architecture",
    {
      title: "BotBlocker architecture overview",
      description: "The allow|otp decision boundary, shared gate-node authority, and exclusions.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(getBotBlockerArchitectureOverview(), null, 2),
        },
      ],
    }),
  );

  mcp.registerResource(
    "botblocker-data-boundary",
    "powerotp://botblocker/docs/data-boundary",
    {
      title: "BotBlocker data and credential boundary",
      description: "Credential/token flow, MCP's own read-only boundary, and what is never emitted.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(getBotBlockerDataBoundary(), null, 2),
        },
      ],
    }),
  );

  mcp.registerTool(
    "list_botblocker_adapters",
    {
      title: "List BotBlocker adapters",
      description:
        "List the three supported BotBlocker adapters (node-http, express, nextjs) with their " +
        "current package version and manifest checksum.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const manifests = buildAllBotBlockerManifests();
      return json(
        Object.values(manifests).map((manifest) => ({
          adapter: manifest.adapter,
          displayName: manifest.displayName,
          packageName: manifest.packageName,
          packageVersion: manifest.packageVersion,
          manifestFormatVersion: manifest.manifestFormatVersion,
          checksumSha256: manifest.checksumSha256,
        })),
      );
    },
  );

  mcp.registerTool(
    "get_botblocker_environment_variables",
    {
      title: "Get BotBlocker environment variable names",
      description:
        "List the exact server-only environment-variable names every BotBlocker adapter reads. " +
        "Names only — never a value, example secret, or .env entry.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () =>
      json({
        required: BOTBLOCKER_ENV_VARS,
        plannedForUpcomingPhase: {
          webhookSigningSecret: BOTBLOCKER_PLANNED_ENV_VARS,
          automaticKeyDeliveryPhase14A: BOTBLOCKER_UNDELIVERED_ENV_VARS,
        },
        placement:
          "Set these in your secure hosting environment's secret/config store (e.g. DigitalOcean " +
          "App Platform environment variables). Never commit them to source control or a browser bundle.",
        dashboardStatus:
          "POWEROTP_SITE_CREDENTIAL is already issued by the shipped " +
          "POST /v1/projects/{projectId}/botblocker/rotate-site-credential endpoint (shown once, " +
          "rotatable). The plannedForUpcomingPhase entries are scheduled work, not settings a " +
          "customer manages today: POWEROTP_WEBHOOK_SIGNING_SECRET ships with the planned " +
          "webhook callback receiver, and the verification key pair is set directly until Phase " +
          "14A automates its delivery from the signed policy release (see " +
          "POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md).",
      }),
  );

  mcp.registerTool(
    "get_botblocker_manifest",
    {
      title: "Get a BotBlocker adapter manifest",
      description:
        "Generate the versioned, checksummed file manifest for one BotBlocker adapter: exact file " +
        "contents, placement paths, and per-file/whole-manifest SHA-256 checksums.",
      inputSchema: z.object({ adapter: BotBlockerAdapterIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ adapter }) => json(AdapterManifestSchema.parse(buildBotBlockerManifest(adapter))),
  );

  mcp.registerTool(
    "get_botblocker_integration_steps",
    {
      title: "Get BotBlocker integration steps",
      description:
        "Get the ordered placement/middleware/Proxy steps and test commands for one adapter, " +
        "without the full file contents (use get_botblocker_manifest for those).",
      inputSchema: z.object({ adapter: BotBlockerAdapterIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ adapter }) => {
      const manifest = buildBotBlockerManifest(adapter);
      return json({
        adapter: manifest.adapter,
        placementSteps: manifest.placementSteps,
        testCommands: manifest.testCommands,
        exclusions: manifest.exclusions,
      });
    },
  );

  mcp.registerTool(
    "get_botblocker_troubleshooting",
    {
      title: "Get BotBlocker troubleshooting guidance",
      description: "Get known limitations and symptom/explanation troubleshooting for one adapter.",
      inputSchema: z.object({ adapter: BotBlockerAdapterIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ adapter }) => {
      const manifest = buildBotBlockerManifest(adapter);
      return json({
        adapter: manifest.adapter,
        knownLimitations: manifest.knownLimitations,
        troubleshooting: manifest.troubleshooting,
      });
    },
  );

  mcp.registerTool(
    "get_botblocker_upgrade_instructions",
    {
      title: "Get BotBlocker upgrade instructions",
      description: "Get the upgrade steps for moving an existing installation to the current manifest.",
      inputSchema: z.object({ adapter: BotBlockerAdapterIdSchema }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ adapter }) => {
      const manifest = buildBotBlockerManifest(adapter);
      return json({
        adapter: manifest.adapter,
        packageVersion: manifest.packageVersion,
        checksumSha256: manifest.checksumSha256,
        upgradeInstructions: manifest.upgradeInstructions,
      });
    },
  );

  mcp.registerTool(
    "verify_botblocker_manifest_checksum",
    {
      title: "Verify a BotBlocker manifest checksum",
      description:
        "Recompute the current manifest checksum for one adapter and compare it against a " +
        "checksum you already have, to confirm whether your copy is current.",
      inputSchema: z.object({
        adapter: BotBlockerAdapterIdSchema,
        checksumSha256: z.string().length(64),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ adapter, checksumSha256 }) => {
      const current = buildBotBlockerManifest(adapter).checksumSha256;
      return json({
        adapter,
        matches: current === checksumSha256,
        currentChecksumSha256: current,
      });
    },
  );
}
