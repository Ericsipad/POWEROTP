import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { loadConfig } from "./config.js";

const requiredEnv = {
  MONGODB_URI: "mongodb://localhost/powerotp",
  VALKEY_URL: "rediss://localhost:6379",
  INTERACTION_TOKEN_SECRET: "a".repeat(32),
  CONFIG_ENCRYPTION_KEY: "b".repeat(32),
  SESSION_HASH_SECRET: "c".repeat(32),
  API_KEY_HASH_SECRET: "d".repeat(32),
  PASSWORD_PEPPER: "e".repeat(32),
  PII_ENCRYPTION_KEY: "f".repeat(32),
  EMAIL_LOOKUP_HASH_SECRET: "g".repeat(32),
  BREVO_API_KEY: "brevo-key",
  EMAIL_FROM: "no-reply@example.com",
  PUBLIC_APP_URL: "https://powerotp.com",
  PUBLIC_API_URL: "https://api.powerotp.com",
};

function encodedEd25519Keys() {
  const active = generateKeyPairSync("ed25519");
  const previous = generateKeyPairSync("ed25519");
  return {
    activePrivate: active.privateKey
      .export({ format: "der", type: "pkcs8" as const })
      .toString("base64"),
    previousPublic: previous.publicKey
      .export({ format: "der", type: "spki" as const })
      .toString("base64"),
  };
}

describe("loadConfig", () => {
  it("parses when every optional field is genuinely absent", () => {
    const configuration = loadConfig(requiredEnv);
    assert.equal(configuration.PUBLIC_APP_URL, "https://powerotp.com");
    assert.equal(configuration.PUBLIC_API_URL, "https://api.powerotp.com");
  });

  it("treats an env var present but set to an empty string as unset", () => {
    // Cloud consoles (DigitalOcean App Platform included) let an operator
    // create a variable with a blank value instead of omitting it, which
    // must not crash the whole app at boot for an optional field.
    assert.doesNotThrow(() =>
      loadConfig({
        ...requiredEnv,
        NODE_SECRET: "",
        TRUNK1_URL: "",
        TRUNK1_USER: "",
        TRUNK1_PASS: "",
        TRUNK1_DID: "",
        VOIPMS_SMS_API_USERNAME: "",
        VOIPMS_SMS_API_PASSWORD: "",
        ADMIN_ALLOWED_IPS: "",
        SPACES_ENDPOINT: "",
        SPACES_BUCKET: "",
        SPACES_ACCESS_KEY: "",
        SPACES_SECRET_KEY: "",
        MEDIA_MANIFEST_SECRET: "",
        POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID: "",
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "",
        BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64: "",
        BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: "",
        BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64: "",
        BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS: "",
        BOTBLOCKER_ED25519_REVOKED_KEY_IDS: "",
        BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: "",
        BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: "",
        BOTBLOCKER_VISITOR_TOKEN_SECRET: "",
        BOTBLOCKER_INTELLIGENCE_HASH_SECRET: "",
        BOTBLOCKER_RUNTIME_ORIGIN: "",
      }),
    );
  });

  it("still rejects a required field left genuinely empty", () => {
    assert.throws(() => loadConfig({ ...requiredEnv, MONGODB_URI: "" }));
  });

  it("requires complete, distinct BotBlocker active and previous key groups", () => {
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_active",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: "key_previous",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "same_key",
        BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64: "YQ==",
        BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: "same_key",
        BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64: "Yg==",
        BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS: "1786000060000",
      }),
    );
  });

  it("validates BotBlocker revocation and bounded clock skew", () => {
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_active",
        BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64: "YQ==",
        BOTBLOCKER_ED25519_REVOKED_KEY_IDS: "key_old,key_active",
      }),
    );
    assert.throws(() =>
      loadConfig({ ...requiredEnv, BOTBLOCKER_CLOCK_SKEW_MS: "300001" }),
    );
    const encoded = encodedEd25519Keys();
    assert.doesNotThrow(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_ED25519_ACTIVE_KEY_ID: "key_active",
        BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64:
          encoded.activePrivate,
        BOTBLOCKER_ED25519_PREVIOUS_KEY_ID: "key_previous",
        BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64:
          encoded.previousPublic,
        BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS: "1786000060000",
        BOTBLOCKER_ED25519_REVOKED_KEY_IDS: "key_retired",
        BOTBLOCKER_CLOCK_SKEW_MS: "1000",
      }),
    );
  });

  it("validates the independent BotBlocker runtime configuration", () => {
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: "short",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_INTELLIGENCE_HASH_SECRET: "short",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: "short",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_VISITOR_TOKEN_SECRET: "short",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        BOTBLOCKER_RUNTIME_ORIGIN: "http://verify.powerotp.com",
      }),
    );
    const configuration = loadConfig({
      ...requiredEnv,
      BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: "h".repeat(32),
      BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET: "w".repeat(32),
      BOTBLOCKER_VISITOR_TOKEN_SECRET: "v".repeat(32),
      BOTBLOCKER_INTELLIGENCE_HASH_SECRET: "i".repeat(32),
      BOTBLOCKER_RUNTIME_ORIGIN: "https://verify.powerotp.com",
    });
    assert.equal(
      configuration.BOTBLOCKER_RUNTIME_ORIGIN,
      "https://verify.powerotp.com",
    );
  });
});
