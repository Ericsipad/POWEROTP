import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./route.js";

describe("GET /health/hosted-auth", () => {
  it("resolves authx from the public host behind an internal route URL", async () => {
    const response = GET(
      new NextRequest("https://internal-app/health/hosted-auth", {
        headers: { host: "authx.powerotp.com" },
      }),
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

  it("resolves authz from a forwarded public authority", async () => {
    const response = GET(
      new NextRequest("https://internal-app/health/hosted-auth", {
        headers: {
          host: "internal-app",
          "x-forwarded-host": "authz.powerotp.com",
        },
      }),
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

  it("rejects unknown, chained, or conflicting authorities", async () => {
    const headerCases: Record<string, string>[] = [
      { host: "api.powerotp.com" },
      { host: "authx.powerotp.com, attacker.example" },
      {
        host: "authx.powerotp.com",
        "x-forwarded-host": "authz.powerotp.com",
      },
    ];
    for (const headers of headerCases) {
      const response = GET(
        new NextRequest("https://internal-app/health/hosted-auth", { headers }),
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        error: "hosted_auth_realm_unavailable",
      });
    }
  });
});
