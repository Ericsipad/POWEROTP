import { z } from "zod";

/**
 * Wire-level fields shared by BotBlocker Ed25519 signed artifacts. Private
 * keys never belong in these contracts; callers pass key material directly
 * to the server-only signing implementation.
 */
export const BotBlockerSigningKeyIdSchema = z.string().min(1).max(128);
export const BotBlockerEd25519SignatureSchema = z
  .string()
  .length(86)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected an unpadded base64url Ed25519 signature");

export const BotBlockerArtifactTypeSchema = z.enum([
  "site_clearance",
  "policy_release",
]);

export const BotBlockerSignatureMetadataSchema = z
  .object({
    artifactType: BotBlockerArtifactTypeSchema,
    keyId: BotBlockerSigningKeyIdSchema,
    audience: z.string().min(1),
    nonce: z.string().min(16),
    issuedAt: z.number().int().positive(),
  })
  .strict();

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Deterministic JSON for signatures: object keys are recursively sorted,
 * array order is retained, and values JSON cannot represent are rejected.
 */
export function canonicalizeBotBlockerArtifact(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Signed artifacts cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Signed artifacts must contain only plain objects");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Signed artifacts cannot contain ${typeof value} values`);
}

export type BotBlockerSigningKeyId = z.infer<typeof BotBlockerSigningKeyIdSchema>;
export type BotBlockerArtifactType = z.infer<typeof BotBlockerArtifactTypeSchema>;
export type BotBlockerSignatureMetadata = z.infer<
  typeof BotBlockerSignatureMetadataSchema
>;
