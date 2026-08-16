import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_PATH = path.resolve(
  APP_DIR,
  "../../../../docs/API_ROUTE_INVENTORY.md",
);
const HTTP_METHOD = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;

interface InventoryEntry {
  source: string;
  routePath: string;
  methods: string[];
}

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() || (await stat(absolute)).isDirectory()) {
        return routeFiles(absolute);
      }
      return entry.name === "route.ts" ? [absolute] : [];
    }),
  );
  return nested.flat().sort();
}

function parseInventory(markdown: string): InventoryEntry[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `app/"))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      assert.equal(cells.length, 7, `Malformed inventory row: ${line}`);
      assert.ok(cells.every(Boolean), `Inventory row has an empty field: ${line}`);
      return {
        source: cells[0]!.replaceAll("`", ""),
        routePath: cells[1]!.replaceAll("`", ""),
        methods: cells[2]!
          .replaceAll("`", "")
          .split(",")
          .map((method) => method.trim())
          .sort(),
      };
    });
}

function expectedHttpPath(source: string): string {
  const relative = source
    .replace(/^app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");
  return relative || "/";
}

describe("canonical API route inventory", () => {
  it("accounts for every route file, path, and exported HTTP method", async () => {
    const [files, markdown] = await Promise.all([
      routeFiles(APP_DIR),
      readFile(INVENTORY_PATH, "utf8"),
    ]);
    const inventory = parseInventory(markdown);
    const bySource = new Map(inventory.map((entry) => [entry.source, entry]));

    assert.equal(
      bySource.size,
      inventory.length,
      "The inventory contains duplicate route-file entries",
    );

    const sources = files.map((file) =>
      path.relative(path.dirname(APP_DIR), file).replaceAll("\\", "/"),
    );
    assert.deepEqual(
      [...bySource.keys()].sort(),
      sources,
      "Inventory route files differ from backend/apps/server/app/**/route.ts",
    );

    for (const file of files) {
      const source = path.relative(path.dirname(APP_DIR), file).replaceAll("\\", "/");
      const entry = bySource.get(source);
      assert.ok(entry, `Missing inventory entry for ${source}`);
      assert.equal(
        entry.routePath,
        expectedHttpPath(source),
        `Incorrect HTTP path for ${source}`,
      );

      const implementation = await readFile(file, "utf8");
      const methods = [...implementation.matchAll(HTTP_METHOD)]
        .map((match) => match[1]!)
        .sort();
      assert.deepEqual(
        entry.methods,
        methods,
        `Exported methods differ for ${source}`,
      );
    }
  });
});
