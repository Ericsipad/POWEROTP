import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./route.js";

const previousDeploymentEnvironment =
  process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT;

afterEach(() => {
  if (previousDeploymentEnvironment === undefined) {
    delete process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT;
  } else {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT =
      previousDeploymentEnvironment;
  }
});

describe("GET /health/hosted-auth", () => {
  it("reports the powerotp_pii realm only on authx", async () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "production";
    const response = GET(
      new NextRequest("https://authx.powerotp.com/health/hosted-auth"),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      service: "powerotp-hosted-auth",
      status: "ok",
      environment: "production",
      identityDataMode: "powerotp_pii",
      realm: "authx.powerotp.com",
      rpId: "authx.powerotp.com",
    });
  });

  it("reports the didit_pii realm only on authz", async () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "production";
    const response = GET(
      new NextRequest("https://authz.powerotp.com/health/hosted-auth"),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      service: "powerotp-hosted-auth",
      status: "ok",
      environment: "production",
      identityDataMode: "didit_pii",
      realm: "authz.powerotp.com",
      rpId: "authz.powerotp.com",
    });
  });

  it("rejects the API host and cross-environment hosts", async () => {
    process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT = "production";
    for (const url of [
      "https://api.powerotp.com/health/hosted-auth",
      "https://authx.staging.powerotp.com/health/hosted-auth",
    ]) {
      const response = GET(new NextRequest(url));
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        error: "hosted_auth_realm_unavailable",
      });
    }
  });
});
