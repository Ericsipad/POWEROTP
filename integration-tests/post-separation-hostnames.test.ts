import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCANNED_EXTENSIONS = new Set([".json", ".md", ".sh", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", "dist", "node_modules"]);

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function repositoryTextFiles(directory = ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : repositoryTextFiles(path.join(directory, entry.name));
    }
    return SCANNED_EXTENSIONS.has(path.extname(entry.name))
      ? [path.join(directory, entry.name)]
      : [];
  });
}

describe("post-separation production hostnames", () => {
  it("keeps backend and frontend deployment variables distinct", () => {
    const deploymentGuide = read("infrastructure/app-platform/README.md");
    assert.match(deploymentGuide, /NEXT_PUBLIC_API_URL=https:\/\/api\.powerotp\.com/);
    assert.match(deploymentGuide, /PUBLIC_API_URL=https:\/\/api\.powerotp\.com/);
    assert.match(deploymentGuide, /PUBLIC_APP_URL=https:\/\/powerotp\.com/);
  });

  it("documents the Stripe webhook and MCP endpoint on the backend hostname", () => {
    assert.match(
      read("README.md"),
      /https:\/\/api\.powerotp\.com\/v1\/billing\/stripe\/webhook/,
    );
    assert.match(
      read("frontend/app/page.tsx"),
      /https:\/\/api\.powerotp\.com\/mcp/,
    );
  });

  it("defaults telephony bootstrap to the backend control plane", () => {
    assert.match(
      read("infrastructure/asterisk/bootstrap-node.sh"),
      /CONTROL_PLANE_URL="\$\{CONTROL_PLANE_URL:-https:\/\/api\.powerotp\.com\}"/,
    );
  });

  it("contains no stale frontend-host API or removed deployment-root references", () => {
    const violations = repositoryTextFiles().flatMap((file) => {
      const contents = readFileSync(file, "utf8");
      const stale = [
        /https:\/\/powerotp\.com\/v1(?:\/|\b)/,
        /https:\/\/powerotp\.com\/mcp(?:\/|\b)/,
        /\bapps\/(?:web|api|mcp|backend)\b/,
        /\bfrontend\/lib\/(?:api-route|session-cookies|demo-project|api-errors|botblocker-http|botblocker-responses|botblocker-policy-http|http-etag)\.ts\b/,
      ];
      return stale.some((pattern) => pattern.test(contents))
        ? [path.relative(ROOT, file).replaceAll("\\", "/")]
        : [];
    });

    assert.deepEqual(violations, []);
  });
});
