import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "./config.js";

const requiredEnv = {
  MONGODB_URI: "mongodb://localhost/powerotp",
  VALKEY_URL: "rediss://localhost:6379",
  INTERACTION_TOKEN_SECRET: "a".repeat(32),
  CONFIG_ENCRYPTION_KEY: "b".repeat(32),
  SESSION_HASH_SECRET: "c".repeat(32),
  API_KEY_HASH_SECRET: "d".repeat(32),
  BREVO_API_KEY: "brevo-key",
  EMAIL_FROM: "no-reply@example.com",
  PUBLIC_APP_URL: "https://powerotp.com",
  PUBLIC_API_URL: "https://powerotp.com",
};

describe("loadConfig", () => {
  it("parses when every optional field is genuinely absent", () => {
    assert.doesNotThrow(() => loadConfig(requiredEnv));
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
      }),
    );
  });

  it("still rejects a required field left genuinely empty", () => {
    assert.throws(() => loadConfig({ ...requiredEnv, MONGODB_URI: "" }));
  });
});
