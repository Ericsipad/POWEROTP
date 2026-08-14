import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { createBotBlockerKeyRing } from "./botblocker-config.js";

describe("API BotBlocker key configuration", () => {
  it("stays disabled when no active key is configured", () => {
    assert.equal(
      createBotBlockerKeyRing({ BOTBLOCKER_CLOCK_SKEW_MS: 0 }),
      undefined,
    );
  });

  it("loads ephemeral Ed25519 DER keys and rejects other key types", () => {
    const active = generateKeyPairSync("ed25519");
    const previous = generateKeyPairSync("ed25519");
    const ring = createBotBlockerKeyRing({
      BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_active_00000001",
      BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64: active.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: "key_previous_000001",
      BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64: previous.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS: 1_786_000_060_000,
      BOTBLOCKER_ED25519_REVOKED_KEY_IDS: "key_revoked_0000001",
      BOTBLOCKER_CLOCK_SKEW_MS: 1_000,
    });

    assert.equal(ring?.activeSigningKey.keyId, "key_active_00000001");
    assert.equal(ring?.verificationKeys.previous?.keyId, "key_previous_000001");

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    assert.throws(() =>
      createBotBlockerKeyRing({
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_not_ed25519",
        BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64: rsa.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64"),
        BOTBLOCKER_CLOCK_SKEW_MS: 0,
      }),
    );
  });
});
