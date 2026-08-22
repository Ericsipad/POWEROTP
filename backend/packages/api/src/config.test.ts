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

const diditEnv = {
  DIDIT_API_KEY: "didit-api-key",
  DIDIT_EMAIL_WORKFLOW_ID: "11111111-1111-4111-8111-111111111111",
  DIDIT_PHONE_WORKFLOW_ID: "22222222-2222-4222-8222-222222222222",
  DIDIT_RECOVERY_WORKFLOW_ID: "33333333-3333-4333-8333-333333333333",
  DIDIT_AGE_WORKFLOW_ID: "44444444-4444-4444-8444-444444444444",
  DIDIT_KYC_WORKFLOW_ID: "55555555-5555-4555-8555-555555555555",
  DIDIT_LIVENESS_WORKFLOW_ID: "66666666-6666-4666-8666-666666666666",
  DIDIT_BIOMETRIC_AUTH_WORKFLOW_ID: "77777777-7777-4777-8777-777777777777",
  DIDIT_WEBHOOK_SECRET: "whsec_didit-webhook-secret",
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
        HOSTED_AUTH_RUNTIME_RESULT_ENCRYPTION_KEY: "",
        DIDIT_API_KEY: "",
        DIDIT_EMAIL_WORKFLOW_ID: "",
        DIDIT_PHONE_WORKFLOW_ID: "",
        DIDIT_RECOVERY_WORKFLOW_ID: "",
        DIDIT_AGE_WORKFLOW_ID: "",
        DIDIT_KYC_WORKFLOW_ID: "",
        DIDIT_LIVENESS_WORKFLOW_ID: "",
        DIDIT_BIOMETRIC_AUTH_WORKFLOW_ID: "",
        DIDIT_WEBHOOK_SECRET: "",
      }),
    );
  });

  it("still rejects a required field left genuinely empty", () => {
    assert.throws(() => loadConfig({ ...requiredEnv, MONGODB_URI: "" }));
  });

  it("accepts only a server-side PostgreSQL URL for hosted identity", () => {
    const configuration = loadConfig({
      ...requiredEnv,
      HOSTED_AUTH_DATABASE_URL:
        "postgresql://POTP_backenduser:secret@db.example.com:5432/postgres",
      HOSTED_AUTH_DATABASE_CA_CERT:
        "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
    });
    assert.equal(
      configuration.HOSTED_AUTH_DATABASE_URL,
      "postgresql://POTP_backenduser:secret@db.example.com:5432/postgres",
    );
    assert.match(
      configuration.HOSTED_AUTH_DATABASE_CA_CERT ?? "",
      /BEGIN CERTIFICATE/,
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        HOSTED_AUTH_DATABASE_URL: "https://db.example.com",
      }),
    );
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        HOSTED_AUTH_DATABASE_CA_CERT: "not-a-certificate",
      }),
    );
  });

  it("validates the dedicated hosted-auth runtime result key", () => {
    assert.throws(() =>
      loadConfig({
        ...requiredEnv,
        HOSTED_AUTH_RUNTIME_RESULT_ENCRYPTION_KEY: "short",
      }),
    );
    assert.equal(
      loadConfig({
        ...requiredEnv,
        HOSTED_AUTH_RUNTIME_RESULT_ENCRYPTION_KEY: "r".repeat(32),
      }).HOSTED_AUTH_RUNTIME_RESULT_ENCRYPTION_KEY,
      "r".repeat(32),
    );
  });

  it("requires one complete purpose-separated Didit configuration", () => {
    const configuration = loadConfig({ ...requiredEnv, ...diditEnv });
    assert.equal(configuration.DIDIT_API_KEY, diditEnv.DIDIT_API_KEY);
    assert.equal(
      configuration.DIDIT_BIOMETRIC_AUTH_WORKFLOW_ID,
      diditEnv.DIDIT_BIOMETRIC_AUTH_WORKFLOW_ID,
    );

    for (const field of Object.keys(diditEnv)) {
      const incomplete = { ...diditEnv };
      delete incomplete[field as keyof typeof incomplete];
      assert.throws(
        () => loadConfig({ ...requiredEnv, ...incomplete }),
        /Every field for the Didit integration must be configured together/,
      );
    }
  });

  it("rejects malformed or reused Didit workflow IDs", () => {
    for (const field of Object.keys(diditEnv).filter((name) =>
      name.endsWith("_WORKFLOW_ID"),
    )) {
      assert.throws(() =>
        loadConfig({
          ...requiredEnv,
          ...diditEnv,
          [field]: "not-a-workflow-uuid",
        }),
      );
    }

    assert.throws(
      () =>
        loadConfig({
          ...requiredEnv,
          ...diditEnv,
          DIDIT_PHONE_WORKFLOW_ID: diditEnv.DIDIT_EMAIL_WORKFLOW_ID,
        }),
      /Every Didit purpose must use a distinct workflow ID/,
    );
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
