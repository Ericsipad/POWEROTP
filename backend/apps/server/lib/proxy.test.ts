import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "../proxy.js";

const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
const previousBotBlockerRuntimeOrigin = process.env.BOTBLOCKER_RUNTIME_ORIGIN;

afterEach(() => {
  if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  if (previousBotBlockerRuntimeOrigin === undefined) {
    delete process.env.BOTBLOCKER_RUNTIME_ORIGIN;
  } else {
    process.env.BOTBLOCKER_RUNTIME_ORIGIN = previousBotBlockerRuntimeOrigin;
  }
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

  it("scopes the planned BotBlocker runtime origin to BotBlocker routes", async () => {
    process.env.PUBLIC_APP_URL = "https://powerotp.com";
    process.env.BOTBLOCKER_RUNTIME_ORIGIN = "https://verify.powerotp.com";

    const allowed = proxy(
      new NextRequest("https://api.powerotp.com/v1/botblocker/challenges", {
        method: "OPTIONS",
        headers: { origin: "https://verify.powerotp.com" },
      }),
    );
    const denied = proxy(
      new NextRequest("https://api.powerotp.com/v1/auth/session", {
        method: "GET",
        headers: { origin: "https://verify.powerotp.com" },
      }),
    );

    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://verify.powerotp.com",
    );
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "origin_not_allowed" });
  });
});
