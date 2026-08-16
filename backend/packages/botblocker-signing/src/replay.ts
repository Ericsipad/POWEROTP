import { createHash } from "node:crypto";

import type { BotBlockerArtifactType } from "@powerotp/contracts";

import { validateBotBlockerClockSkew } from "./key-ring.js";

export interface BotBlockerAtomicNonceStore {
  set(
    key: string,
    value: string,
    expiryMode: "PX",
    ttlMs: number,
    condition: "NX",
  ): Promise<"OK" | null>;
}

export interface BotBlockerNonceScope {
  artifactType: BotBlockerArtifactType;
  siteId: string;
  audience: string;
  sessionId?: string;
}

export type BotBlockerNonceConsumptionResult =
  | { ok: true }
  | { ok: false; code: "expired" | "replay_detected" | "storage_unavailable" };

/**
 * Atomically consumes a nonce with Valkey's SET NX PX primitive. Callers must
 * first verify the signed artifact and then pass its trusted claims here.
 * Storage failures return a rejection instead of silently accepting replay.
 */
export async function consumeBotBlockerNonce(
  store: BotBlockerAtomicNonceStore,
  options: {
    scope: BotBlockerNonceScope;
    nonce: string;
    expiresAt: number;
    now?: number;
    clockSkewMs?: number;
  },
): Promise<BotBlockerNonceConsumptionResult> {
  const now = options.now ?? Date.now();
  const clockSkewMs = validateBotBlockerClockSkew(options.clockSkewMs);
  const validUntil = options.expiresAt + clockSkewMs;
  if (!Number.isSafeInteger(validUntil) || validUntil <= now) {
    return { ok: false, code: "expired" };
  }

  const ttlMs = validUntil - now;
  try {
    const stored = await store.set(
      replayKey(options.scope, options.nonce),
      "1",
      "PX",
      ttlMs,
      "NX",
    );
    return stored === "OK"
      ? { ok: true }
      : { ok: false, code: "replay_detected" };
  } catch {
    return { ok: false, code: "storage_unavailable" };
  }
}

function replayKey(scope: BotBlockerNonceScope, nonce: string): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        scope.artifactType,
        scope.siteId,
        scope.audience,
        scope.sessionId ?? null,
        nonce,
      ]),
    )
    .digest("base64url");
  return `botblocker:nonce:v1:${scope.artifactType}:${digest}`;
}
