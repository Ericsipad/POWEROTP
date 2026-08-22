import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import {
  authenticateApiKey,
  authenticateProjectApiKey,
} from "./project-api-auth.js";
import type { ApiKeyDocument, ProjectDocument } from "./persistence.js";
import { hashToken } from "./security.js";

const secret = "a".repeat(32);
const rawKey = "potp_sk_test-project-key";

function fixture(backendIpAllowlist: string[]) {
  const project = {
    _id: "prj_test",
    customerId: "usr_owner",
    name: "Test",
    slug: "test-project",
    active: true,
    authSettings: { backendIpAllowlist },
  } as ProjectDocument;
  const apiKey = {
    _id: "key_test",
    projectId: project._id,
    customerId: project.customerId,
    keyHash: hashToken(rawKey, secret),
  } as ApiKeyDocument;
  return {
    project,
    db: {
      collection(name: string) {
        return {
          findOne: async (filter: Record<string, unknown>) => {
            if (name === "apiKeys") {
              return filter.keyHash === apiKey.keyHash ? apiKey : null;
            }
            return filter._id === project._id ? project : null;
          },
        };
      },
    } as unknown as Db,
  };
}

describe("project API key source allowlist", () => {
  it("keeps API-key authentication mandatory before source authorization", async () => {
    const { db } = fixture(["203.0.113.0/24"]);
    await assert.rejects(
      authenticateProjectApiKey(db, { API_KEY_HASH_SECRET: secret }, "test-project", undefined, "203.0.113.4"),
      (error: unknown) => error instanceof Error && error.message === "authentication_required",
    );
    await assert.rejects(
      authenticateProjectApiKey(
        db,
        { API_KEY_HASH_SECRET: secret },
        "wrong-project",
        `Bearer ${rawKey}`,
        "203.0.114.4",
      ),
      (error: unknown) => error instanceof Error && error.message === "authentication_required",
    );
  });

  it("allows unrestricted serverless clients when the allowlist is empty", async () => {
    const { db, project } = fixture([]);
    assert.equal(
      await authenticateProjectApiKey(
        db,
        { API_KEY_HASH_SECRET: secret },
        "test-project",
        `Bearer ${rawKey}`,
        undefined,
      ),
      project,
    );
  });

  it("enforces IPv4 and IPv6 ranges after authenticating the project key", async () => {
    const { db } = fixture(["203.0.113.0/24", "2001:db8::/32"]);
    for (const allowed of ["203.0.113.44", "2001:db8:1::44"]) {
      await authenticateProjectApiKey(
        db,
        { API_KEY_HASH_SECRET: secret },
        "test-project",
        `Bearer ${rawKey}`,
        allowed,
      );
    }
    for (const denied of [
      "203.0.114.44",
      "2001:db9::44",
      "::ffff:203.0.113.44",
      undefined,
    ]) {
      await assert.rejects(
        authenticateProjectApiKey(
          db,
          { API_KEY_HASH_SECRET: secret },
          "test-project",
          `Bearer ${rawKey}`,
          denied,
        ),
        (error: unknown) => error instanceof Error && error.message === "source_ip_not_allowed",
      );
    }
  });

  it("enforces the same policy on project-key routes without a slug", async () => {
    const { db, project } = fixture(["203.0.113.0/24"]);
    assert.equal(
      await authenticateApiKey(
        db,
        { API_KEY_HASH_SECRET: secret },
        `Bearer ${rawKey}`,
        "203.0.113.44",
      ),
      project,
    );
    await assert.rejects(
      authenticateApiKey(
        db,
        { API_KEY_HASH_SECRET: secret },
        `Bearer ${rawKey}`,
        "198.51.100.44",
      ),
      (error: unknown) => error instanceof Error && error.message === "source_ip_not_allowed",
    );
  });
});
