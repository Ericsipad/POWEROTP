import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "../proxy.js";

const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
const previousBotBlockerRuntimeOrigin = process.env.BOTBLOCKER_RUNTIME_ORIGIN;
const previousHostedAuthDeploymentEnvironment =
  process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT;

afterEach(() => {
  if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  if (previousBotBlockerRuntimeOrigin === undefined) {
    delete process.env.BOTBLOCKER_RUNTIME_ORIGIN;
  } else {
    process.env.BOTBLOCKER_RUNTIME_ORIGIN = previousBotBlockerRuntimeOrigin;
  }
  if (previousHostedAuthDeploymentEnvironment === undefined) {
    delete process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT;
  } else {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT =
      previousHostedAuthDeploymentEnvironment;
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

describe("backend hosted-auth host routing", () => {
  it("allows only the realm health route before hosted handlers exist", async () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "production";
    const health = proxy(
      new NextRequest("https://authx.powerotp.com/health/hosted-auth"),
    );
    const api = proxy(
      new NextRequest("https://authx.powerotp.com/v1/auth/session"),
    );

    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-middleware-next"), "1");
    assert.equal(api.status, 404);
    assert.equal(api.headers.get("cache-control"), "no-store");
    assert.deepEqual(await api.json(), {
      error: "hosted_auth_route_unavailable",
    });
  });

  it("rejects a realm hostname from another environment", async () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "staging";
    const response = proxy(
      new NextRequest("https://authz.powerotp.com/health/hosted-auth"),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "hosted_auth_route_unavailable",
    });
  });

  it("does not alter API-host routing", () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "production";
    const response = proxy(
      new NextRequest("https://api.powerotp.com/v1/capabilities"),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});
