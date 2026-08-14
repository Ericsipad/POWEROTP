import {
  createPrivateKey,
  createPublicKey,
  type KeyLike,
  type KeyObject,
} from "node:crypto";

import { BotBlockerSigningKeyIdSchema } from "@powerotp/contracts";

export const MAX_BOTBLOCKER_CLOCK_SKEW_MS = 300_000;

export interface BotBlockerActiveSigningKey {
  keyId: string;
  privateKey: KeyLike;
}

export interface BotBlockerPublicVerificationKey {
  keyId: string;
  publicKey: KeyLike;
}

export interface BotBlockerPreviousVerificationKey
  extends BotBlockerPublicVerificationKey {
  verifyUntil: number;
}

export interface BotBlockerVerificationKeySet {
  active: BotBlockerPublicVerificationKey;
  previous?: BotBlockerPreviousVerificationKey;
  revokedKeyIds?: ReadonlySet<string>;
}

export interface BotBlockerKeyRing {
  activeSigningKey: BotBlockerActiveSigningKey;
  verificationKeys: BotBlockerVerificationKeySet;
  clockSkewMs: number;
}

export interface BotBlockerKeyConfiguration {
  activeKeyId: string;
  activePrivateKeyPkcs8Base64: string;
  previousKeyId?: string;
  previousPublicKeySpkiBase64?: string;
  previousVerifyUntil?: number;
  revokedKeyIds?: readonly string[];
  clockSkewMs?: number;
}

export type VerificationKeyResolution =
  | { ok: true; publicKey: KeyLike }
  | { ok: false; reason: "revoked" | "retired" | "untrusted" };

export function loadBotBlockerKeyRing(
  configuration: BotBlockerKeyConfiguration,
): BotBlockerKeyRing {
  const activeKeyId = parseKeyId(configuration.activeKeyId);
  const clockSkewMs = validateBotBlockerClockSkew(configuration.clockSkewMs);
  const privateKey = importPrivateKey(configuration.activePrivateKeyPkcs8Base64);
  const activePublicKey = createPublicKey(privateKey);
  const revokedKeyIds = new Set((configuration.revokedKeyIds ?? []).map(parseKeyId));

  if (revokedKeyIds.has(activeKeyId)) {
    throw new TypeError("The active BotBlocker signing key cannot be revoked");
  }

  const previousValues = [
    configuration.previousKeyId,
    configuration.previousPublicKeySpkiBase64,
    configuration.previousVerifyUntil,
  ];
  const configuredPreviousValues = previousValues.filter(
    (value) => value !== undefined,
  ).length;
  if (configuredPreviousValues !== 0 && configuredPreviousValues !== previousValues.length) {
    throw new TypeError(
      "Previous BotBlocker key ID, public key, and verification deadline must be configured together",
    );
  }

  let previous: BotBlockerPreviousVerificationKey | undefined;
  if (
    configuration.previousKeyId !== undefined &&
    configuration.previousPublicKeySpkiBase64 !== undefined &&
    configuration.previousVerifyUntil !== undefined
  ) {
    const previousKeyId = parseKeyId(configuration.previousKeyId);
    if (previousKeyId === activeKeyId) {
      throw new TypeError("Active and previous BotBlocker key IDs must differ");
    }
    if (
      !Number.isSafeInteger(configuration.previousVerifyUntil) ||
      configuration.previousVerifyUntil <= 0
    ) {
      throw new TypeError("Previous BotBlocker verification deadline must be a Unix millisecond timestamp");
    }
    previous = {
      keyId: previousKeyId,
      publicKey: importPublicKey(configuration.previousPublicKeySpkiBase64),
      verifyUntil: configuration.previousVerifyUntil,
    };
  }

  return {
    activeSigningKey: { keyId: activeKeyId, privateKey },
    verificationKeys: {
      active: { keyId: activeKeyId, publicKey: activePublicKey },
      previous,
      revokedKeyIds,
    },
    clockSkewMs,
  };
}

export function resolveBotBlockerVerificationKey(
  keySet: BotBlockerVerificationKeySet,
  keyId: string,
  now: number,
): VerificationKeyResolution {
  if (keySet.revokedKeyIds?.has(keyId)) {
    return { ok: false, reason: "revoked" };
  }
  if (keyId === keySet.active.keyId) {
    return { ok: true, publicKey: keySet.active.publicKey };
  }
  if (keyId !== keySet.previous?.keyId) {
    return { ok: false, reason: "untrusted" };
  }
  if (now >= keySet.previous.verifyUntil) {
    return { ok: false, reason: "retired" };
  }
  return { ok: true, publicKey: keySet.previous.publicKey };
}

export function validateBotBlockerClockSkew(value = 0): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_BOTBLOCKER_CLOCK_SKEW_MS
  ) {
    throw new TypeError(
      `BotBlocker clock skew must be an integer from 0 through ${MAX_BOTBLOCKER_CLOCK_SKEW_MS} ms`,
    );
  }
  return value;
}

function parseKeyId(value: string): string {
  return BotBlockerSigningKeyIdSchema.parse(value);
}

function importPrivateKey(value: string): KeyObject {
  const key = createPrivateKey({
    key: decodeBase64(value, "private"),
    format: "der",
    type: "pkcs8",
  });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("BotBlocker active private key must be Ed25519 PKCS#8 DER");
  }
  return key;
}

function importPublicKey(value: string): KeyObject {
  const key = createPublicKey({
    key: decodeBase64(value, "public"),
    format: "der",
    type: "spki",
  });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("BotBlocker previous public key must be Ed25519 SPKI DER");
  }
  return key;
}

function decodeBase64(value: string, label: string): Buffer {
  if (
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new TypeError(`BotBlocker ${label} key must use canonical base64`);
  }
  return Buffer.from(value, "base64");
}
