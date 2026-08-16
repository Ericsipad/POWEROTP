import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildBotBlockerManifest } from "../backend/packages/mcp/src/botblocker/manifest.js";
import { BOTBLOCKER_ADAPTER_IDS } from "../backend/packages/mcp/src/botblocker/types.js";

describe("BotBlocker manifest package versions", () => {
  for (const adapter of BOTBLOCKER_ADAPTER_IDS) {
    it(`${adapter} matches its adapter package`, () => {
      const directory =
        adapter === "node-http"
          ? "gate-node"
          : adapter === "express"
            ? "gate-express"
            : "gate-next";
      const packageJson = JSON.parse(
        readFileSync(
          new URL(`../libraries/${directory}/package.json`, import.meta.url),
          "utf8",
        ),
      ) as { version: string };
      assert.equal(buildBotBlockerManifest(adapter).packageVersion, packageJson.version);
    });
  }
});
