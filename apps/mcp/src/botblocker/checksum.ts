import { createHash } from "node:crypto";

/**
 * Deterministic hex SHA-256, used for both per-file and whole-manifest
 * checksums. Callers must pass a value whose serialization is itself stable
 * (fixed key order) — this helper does no canonicalization of its own.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
