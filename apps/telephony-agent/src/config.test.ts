import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAgentConfig } from "./config.js";

const requiredEnvironment = {
  NODE_SECRET: "n".repeat(32),
  CONTROL_PLANE_URL: "https://api.powerotp.com",
  ARI_USER: "powerotp",
  ARI_PASS: "local-ari-password",
};

describe("telephony agent configuration", () => {
  it("accepts the production backend as the control plane", () => {
    const config = loadAgentConfig(requiredEnvironment);
    assert.equal(config.CONTROL_PLANE_URL, "https://api.powerotp.com");
  });

  it("rejects an insecure control-plane origin", () => {
    assert.throws(() =>
      loadAgentConfig({
        ...requiredEnvironment,
        CONTROL_PLANE_URL: "http://api.powerotp.com",
      }),
    );
  });
});
