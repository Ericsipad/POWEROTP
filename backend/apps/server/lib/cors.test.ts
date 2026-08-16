import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configuredBrowserOriginsForPath, corsHeaders } from "./cors.js";

describe("backend CORS policy", () => {
  it("allows only configured browser origins", () => {
    const env = {
      PUBLIC_APP_URL: "https://powerotp.com/dashboard",
      BOTBLOCKER_RUNTIME_ORIGIN: "https://verify.powerotp.com",
    };
    const origins = configuredBrowserOriginsForPath(
      "/v1/botblocker/challenges",
      env,
    );
    assert.deepEqual(
      [...origins],
      ["https://powerotp.com", "https://verify.powerotp.com"],
    );
    assert.deepEqual(
      [...configuredBrowserOriginsForPath("/v1/auth/session", env)],
      ["https://powerotp.com"],
    );
  });

  it("returns credentialed exact-origin headers", () => {
    const headers = corsHeaders("https://powerotp.com");
    assert.equal(headers.get("access-control-allow-origin"), "https://powerotp.com");
    assert.equal(headers.get("access-control-allow-credentials"), "true");
    assert.equal(headers.get("vary"), "Origin");
    assert.match(headers.get("access-control-allow-headers") ?? "", /x-csrf-token/);
  });
});
