import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOSTED_AUTH_DEPLOYMENTS,
  hostedAuthDeploymentEnvironment,
  resolveHostedAuthRealm,
} from "./hosted-auth-realms.js";

describe("hosted-auth realm deployment configuration", () => {
  it("keeps production custody modes on exact independent realms", () => {
    assert.deepEqual(
      resolveHostedAuthRealm("authx.powerotp.com", "production"),
      {
        environment: "production",
        identityDataMode: "powerotp_pii",
        ...HOSTED_AUTH_DEPLOYMENTS.production.powerotp_pii,
      },
    );
    assert.deepEqual(
      resolveHostedAuthRealm("authz.powerotp.com", "production"),
      {
        environment: "production",
        identityDataMode: "didit_pii",
        ...HOSTED_AUTH_DEPLOYMENTS.production.didit_pii,
      },
    );
  });

  it("does not resolve a realm from another environment", () => {
    for (const environment of [
      "staging",
      "development",
      "test",
    ] as const) {
      assert.equal(
        resolveHostedAuthRealm("authx.powerotp.com", environment),
        null,
      );
      assert.equal(
        resolveHostedAuthRealm("authz.powerotp.com", environment),
        null,
      );
    }
  });

  it("uses explicit deployment selection with safe local defaults", () => {
    assert.equal(
      hostedAuthDeploymentEnvironment("staging", "production"),
      "staging",
    );
    assert.equal(hostedAuthDeploymentEnvironment(undefined, "production"), "production");
    assert.equal(hostedAuthDeploymentEnvironment(undefined, "test"), "test");
    assert.equal(
      hostedAuthDeploymentEnvironment(undefined, "development"),
      "development",
    );
    assert.throws(
      () => hostedAuthDeploymentEnvironment("preview", "production"),
      /Invalid hosted-auth deployment environment/,
    );
  });

  it("never shares a hostname, origin, or RP ID across modes or environments", () => {
    const realms = Object.entries(HOSTED_AUTH_DEPLOYMENTS).flatMap(
      ([environment, deployment]) =>
        Object.entries(deployment).map(([identityDataMode, realm]) => ({
          environment,
          identityDataMode,
          ...realm,
        })),
    );
    for (const field of ["hostname", "origin", "rpId"] as const) {
      assert.equal(new Set(realms.map((realm) => realm[field])).size, realms.length);
    }
  });
});
