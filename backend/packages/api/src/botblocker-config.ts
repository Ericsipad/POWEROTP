import {
  loadBotBlockerKeyRing,
  type BotBlockerKeyRing,
} from "@powerotp/botblocker-signing";

import type { ProductionConfig } from "./config.js";

type ApiBotBlockerConfig = Pick<
  ProductionConfig,
  | "BOTBLOCKER_ED25519_ACTIVE_KEY_ID"
  | "BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64"
  | "BOTBLOCKER_ED25519_PREVIOUS_KEY_ID"
  | "BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64"
  | "BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS"
  | "BOTBLOCKER_ED25519_REVOKED_KEY_IDS"
  | "BOTBLOCKER_CLOCK_SKEW_MS"
>;

/**
 * Returns no key ring while BotBlocker is intentionally unconfigured. If an
 * active key is configured, malformed or non-Ed25519 material fails startup
 * validation instead of leaving a partially trusted runtime.
 */
export function createBotBlockerKeyRing(
  configuration: ApiBotBlockerConfig,
): BotBlockerKeyRing | undefined {
  const activeKeyId = configuration.BOTBLOCKER_ED25519_ACTIVE_KEY_ID;
  const activePrivateKey =
    configuration.BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64;
  if (!activeKeyId || !activePrivateKey) return undefined;

  return loadBotBlockerKeyRing({
    activeKeyId,
    activePrivateKeyPkcs8Base64: activePrivateKey,
    previousKeyId: configuration.BOTBLOCKER_ED25519_PREVIOUS_KEY_ID,
    previousPublicKeySpkiBase64:
      configuration.BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64,
    previousVerifyUntil:
      configuration.BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS,
    revokedKeyIds:
      configuration.BOTBLOCKER_ED25519_REVOKED_KEY_IDS?.split(","),
    clockSkewMs: configuration.BOTBLOCKER_CLOCK_SKEW_MS,
  });
}
