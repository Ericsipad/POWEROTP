import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { allBotBlockerEnvVarNames } from "./env.js";
import { buildAllBotBlockerManifests, buildBotBlockerManifest } from "./manifest.js";
import { AdapterManifestSchema } from "./schemas.js";
import { BOTBLOCKER_ADAPTER_IDS } from "./types.js";

const CREDENTIAL_LIKE_PATTERNS = [
  /potp_bb_/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /siteCredential\s*[:=]\s*["'](?!process\.env)/,
  /verificationKeys\s*[:=]\s*\{[^}]*keyId\s*:\s*["'](?!process\.env)/s,
];

const PROHIBITED_ROUTE_PATTERNS = [
  /powerotp\/aisummary/,
  /cleandatapage/i,
];

/**
 * MCP output is read by customers and their AI tools, not by PowerOTP staff. It must never
 * mention internal phase numbers, roadmap doc filenames, or "not built yet"/"planned" framing —
 * it describes how to install and use the product today, nothing about how it was developed.
 */
const DEV_PROCESS_LEAK_PATTERNS = [
  /\bphase\s*\d+[a-z]?\b/i,
  /POWEROTP_BOTBLOCKER_\w+\.md/i,
  /\bnot yet\b/i,
  /\bplanned\b/i,
  /\balready-shipped\b/i,
  /\broadmap\b/i,
  /\bwired in\b/i,
];

describe("BotBlocker MCP manifests", () => {
  for (const adapter of BOTBLOCKER_ADAPTER_IDS) {
    describe(adapter, () => {
      it("validates against the strict output schema", () => {
        const manifest = buildBotBlockerManifest(adapter);
        assert.doesNotThrow(() => AdapterManifestSchema.parse(manifest));
      });

      it("is byte-for-byte reproducible across independent builds", () => {
        const first = buildBotBlockerManifest(adapter);
        const second = buildBotBlockerManifest(adapter);
        assert.deepEqual(first, second);
      });

      it("has a manifest checksum matching a fresh recomputation", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const canonical = [
          `adapter:${manifest.adapter}`,
          `package:${manifest.packageName}@${manifest.packageVersion}`,
          `format:${manifest.manifestFormatVersion}`,
          ...manifest.files.map((file) => `file:${file.path}:${file.checksumSha256}`),
        ].join("\n");
        const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
        assert.equal(manifest.checksumSha256, expected);
      });

      it("contains no credential-like literals, only environment variable references", () => {
        const manifest = buildBotBlockerManifest(adapter);
        for (const file of manifest.files) {
          for (const pattern of CREDENTIAL_LIKE_PATTERNS) {
            assert.doesNotMatch(file.contents, pattern, `${file.path} matched ${pattern}`);
          }
        }
      });

      it("never scaffolds a customer-hosted CleanDataPage or hidden honeypot route", () => {
        const manifest = buildBotBlockerManifest(adapter);
        for (const file of manifest.files) {
          for (const pattern of PROHIBITED_ROUTE_PATTERNS) {
            assert.doesNotMatch(file.contents, pattern, `${file.path} matched ${pattern}`);
          }
        }
      });

      it("references every required environment variable name by name only", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.files.map((file) => file.contents).join("\n");
        const requiredNames = allBotBlockerEnvVarNames().filter((name) =>
          combined.includes(name),
        );
        assert.ok(
          requiredNames.includes("POWEROTP_PROJECT_ID") &&
            requiredNames.includes("POWEROTP_SITE_ID") &&
            requiredNames.includes("POWEROTP_WEBHOOK_ID") &&
            requiredNames.includes("POWEROTP_SITE_CREDENTIAL") &&
            requiredNames.includes("POWEROTP_WEBHOOK_SIGNING_SECRET") &&
            requiredNames.includes("POWEROTP_AUDIENCE"),
          "expected every active integration env var name to appear",
        );
      });

      it("instructs the customer to copy atomic project setup values", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.placementSteps.join("\n");
        assert.match(combined, /POWEROTP_WEBHOOK_SIGNING_SECRET/);
        assert.match(combined, /project creation response/);
      });

      it("does not fabricate a webhook receiver route no adapter implements", () => {
        const manifest = buildBotBlockerManifest(adapter);
        for (const file of manifest.files) {
          assert.doesNotMatch(file.contents, /webhooks\/challenge-status/);
        }
      });

      it("describes the returning-visitor instant-allow cookie without exposing dev process", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.knownLimitations.join("\n");
        assert.match(combined, /returning-visitor|instant-allow|fail-open/i);
      });

      it("never exposes phase numbers, roadmap doc filenames, or \"not built yet\" framing", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const surfaces = [
          ...manifest.files.map((file) => file.contents),
          ...manifest.knownLimitations,
          ...manifest.placementSteps,
          ...manifest.testCommands,
          ...manifest.exclusions,
          ...manifest.upgradeInstructions,
          ...manifest.troubleshooting.flatMap((entry) => [entry.symptom, entry.explanation]),
        ];
        for (const text of surfaces) {
          for (const pattern of DEV_PROCESS_LEAK_PATTERNS) {
            assert.doesNotMatch(text, pattern, `"${text}" matched ${pattern}`);
          }
        }
      });

      it("points to the real site-credential rotation endpoint instead of an invented flow", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.placementSteps.join("\n");
        assert.match(
          combined,
          /POST \/v1\/projects\/\{projectId\}\/botblocker\/rotate-site-credential/,
        );
      });
    });
  }

  it("produces three distinct, differently checksummed manifests", () => {
    const manifests = buildAllBotBlockerManifests();
    const checksums = Object.values(manifests).map((manifest) => manifest.checksumSha256);
    assert.equal(new Set(checksums).size, 3);
  });

  it("never emits an actual dashboard/hosting credential value", () => {
    const manifests = buildAllBotBlockerManifests();
    for (const manifest of Object.values(manifests)) {
      for (const file of manifest.files) {
        assert.doesNotMatch(file.contents, /POWEROTP_SITE_CREDENTIAL\s*=\s*["'][^"']+["']/);
      }
    }
  });

  it("never exposes phase numbers, roadmap doc filenames, or \"not built yet\" framing in tool/resource content", async () => {
    const { getBotBlockerArchitectureOverview, getBotBlockerDataBoundary } = await import(
      "./architecture.js"
    );
    const surfaces = [
      JSON.stringify(getBotBlockerArchitectureOverview()),
      JSON.stringify(getBotBlockerDataBoundary()),
    ];
    for (const text of surfaces) {
      for (const pattern of DEV_PROCESS_LEAK_PATTERNS) {
        assert.doesNotMatch(text, pattern, `matched ${pattern}`);
      }
    }
  });
});
