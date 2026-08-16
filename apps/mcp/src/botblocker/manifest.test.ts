import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
          requiredNames.includes("POWEROTP_SITE_ID") &&
            requiredNames.includes("POWEROTP_SITE_CREDENTIAL"),
          "expected the two intended-design env var names to appear",
        );
      });

      it("does not fabricate a webhook receiver route no adapter implements", () => {
        const manifest = buildBotBlockerManifest(adapter);
        for (const file of manifest.files) {
          assert.doesNotMatch(file.contents, /webhooks\/challenge-status/);
        }
      });

      it("notes Phase 14A's planned automatic key delivery and the planned webhook secret", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.knownLimitations.join("\n");
        assert.match(combined, /Phase 14A/);
        assert.match(combined, /returning-visitor instant-allow cookie/);
        assert.match(combined, /POWEROTP_WEBHOOK_SIGNING_SECRET/);
      });

      it("points to the real site-credential rotation endpoint instead of an invented flow", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const combined = manifest.placementSteps.join("\n");
        assert.match(
          combined,
          /POST \/v1\/projects\/\{projectId\}\/botblocker\/rotate-site-credential/,
        );
      });

      it("matches the real libraries/gate-* package.json version (no stale manifest)", () => {
        const manifest = buildBotBlockerManifest(adapter);
        const directory =
          adapter === "node-http" ? "gate-node" : adapter === "express" ? "gate-express" : "gate-next";
        const packageJson = JSON.parse(
          readFileSync(
            new URL(`../../../../libraries/${directory}/package.json`, import.meta.url),
            "utf8",
          ),
        ) as { version: string };
        assert.equal(manifest.packageVersion, packageJson.version);
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
});
