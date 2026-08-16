import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "../proxy.js";

const previousPublicAppUrl = process.env.PUBLIC_APP_URL;

afterEach(() => {
  if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
});

describe("backend proxy CORS", () => {
  it("answers an allowed credentialed preflight", () => {
    process.env.PUBLIC_APP_URL = "https://powerotp.com";
    const response = proxy(
      new NextRequest("https://api.powerotp.com/v1/auth/login", {
        method: "OPTIONS",
        headers: { origin: "https://powerotp.com" },
      }),
    );

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://powerotp.com",
    );
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  });

  it("rejects an unconfigured browser origin", async () => {
    process.env.PUBLIC_APP_URL = "https://powerotp.com";
    const response = proxy(
      new NextRequest("https://api.powerotp.com/v1/auth/login", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
  });
});
