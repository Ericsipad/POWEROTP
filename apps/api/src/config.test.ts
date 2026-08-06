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
        OUTBOUND1_URL: "",
        OUTBOUND1_USER: "",
        OUTBOUND1_PASS: "",
        ADMIN_ALLOWED_IPS: "",
      }),
    );
  });

  it("still rejects a required field left genuinely empty", () => {
    assert.throws(() => loadConfig({ ...requiredEnv, MONGODB_URI: "" }));
  });
});
