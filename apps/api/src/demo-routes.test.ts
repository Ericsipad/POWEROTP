import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Db } from "mongodb";

import { buildApp } from "./app.js";
import type { AuthService } from "./auth-service.js";
import type { ProjectService } from "./project-service.js";
import type { VerificationService } from "./verification-service.js";

const phase2 = {
  auth: {} as unknown as AuthService,
  config: { PUBLIC_APP_URL: "https://app.example.test" },
  projects: {} as unknown as ProjectService,
};

describe("public demo endpoints", () => {
  it("are disabled (404) when DEMO_PROJECT_SLUG is not configured", async () => {
    const app = buildApp(
      undefined,
      phase2,
      {
        db: {} as unknown as Db,
        config: {
          API_KEY_HASH_SECRET: "api-key-hash-secret-with-32-plus-characters",
          INTERACTION_TOKEN_SECRET: "interaction-token-secret-with-32-plus-chars",
          PUBLIC_APP_URL: "https://app.example.test",
          DEMO_PROJECT_SLUG: undefined,
        },
        verifications: {} as unknown as VerificationService,
      },
    );
    after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/demo/verifications",
      payload: { type: "call_reachability", targetNumber: "+15551234567" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "demo_not_configured");
  });
});
