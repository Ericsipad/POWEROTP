import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildBotBlockerManifest } from "./manifest.js";
import { BOTBLOCKER_ADAPTER_IDS } from "./types.js";

/**
 * Compiles every generated adapter example with the repository's own
 * TypeScript CLI (this monorepo depends on the native TypeScript 7 compiler,
 * which — unlike classic TypeScript — exposes no embeddable `ts.createProgram`
 * API, so this shells out to `tsc` exactly like every workspace's own
 * `typecheck` script does). Workspace packages must already be built — run
 * `npm run build` before this suite, exactly as `npm run verify` already
 * does for every other package.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/mcp/src/botblocker -> apps/mcp
const MCP_ROOT = join(HERE, "..", "..");
const CHECK_ROOT = join(MCP_ROOT, ".botblocker-typecheck");

const require = createRequire(import.meta.url);
const TSC_BIN = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    jsx: "react-jsx",
    lib: ["DOM", "DOM.Iterable", "ESNext"],
    strict: true,
    esModuleInterop: true,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    allowJs: false,
    types: ["node"],
  },
  include: ["**/*.ts", "**/*.tsx"],
};

after(() => {
  rmSync(CHECK_ROOT, { recursive: true, force: true });
});

describe("BotBlocker generated adapter examples typecheck", () => {
  for (const adapter of BOTBLOCKER_ADAPTER_IDS) {
    it(`compiles the ${adapter} manifest against current @powerotp/gate-* APIs`, () => {
      const manifest = buildBotBlockerManifest(adapter);
      const baseDir = join(CHECK_ROOT, adapter);
      rmSync(baseDir, { recursive: true, force: true });
      mkdirSync(baseDir, { recursive: true });

      for (const file of manifest.files) {
        const absolute = join(baseDir, file.path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, file.contents, "utf8");
      }
      const tsconfigPath = join(baseDir, "tsconfig.json");
      writeFileSync(tsconfigPath, JSON.stringify(TSCONFIG, null, 2), "utf8");

      const result = spawnSync(
        process.execPath,
        [TSC_BIN, "-p", tsconfigPath, "--noEmit"],
        { cwd: baseDir, encoding: "utf8" },
      );

      assert.equal(
        result.status,
        0,
        `${adapter} manifest failed to typecheck:\n${result.stdout}\n${result.stderr}`,
      );
    });
  }
});
