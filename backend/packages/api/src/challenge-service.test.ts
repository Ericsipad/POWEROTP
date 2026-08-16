import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { ChallengeService } from "./challenge-service.js";
import { encryptString } from "./security.js";

// Constructing a real Db object without connecting is fine here: these
// tests only exercise pure-logic methods (grading, basename derivation,
// and the "not configured" manifest short-circuit) that never touch the
// collections this fake stands in for.
const fakeDb = { collection: () => ({}) } as unknown as Db;

const config = {
  CONFIG_ENCRYPTION_KEY: "configuration-key-with-at-least-32-characters",
  MEDIA_MANIFEST_SECRET: undefined,
  SPACES_ENDPOINT: undefined,
  SPACES_BUCKET: undefined,
  SPACES_ACCESS_KEY: undefined,
  SPACES_SECRET_KEY: undefined,
};

describe("ChallengeService", () => {
  it("grades an exact-set match as correct regardless of submission order", () => {
    const service = new ChallengeService(fakeDb, config, undefined);
    const encrypted = encryptString(
      JSON.stringify(["opt_b", "opt_a"]),
      config.CONFIG_ENCRYPTION_KEY,
    );
    assert.equal(service.gradeSubmission(encrypted, ["opt_a", "opt_b"]), true);
  });

  it("fails a partial, extra, or wrong submission", () => {
    const service = new ChallengeService(fakeDb, config, undefined);
    const encrypted = encryptString(
      JSON.stringify(["opt_a", "opt_b"]),
      config.CONFIG_ENCRYPTION_KEY,
    );
    assert.equal(service.gradeSubmission(encrypted, ["opt_a"]), false);
    assert.equal(service.gradeSubmission(encrypted, ["opt_a", "opt_c"]), false);
    assert.equal(service.gradeSubmission(encrypted, ["opt_a", "opt_b", "opt_c"]), false);
  });

  it("builds a deterministic, path-free sound basename", () => {
    const service = new ChallengeService(fakeDb, config, undefined);
    assert.equal(service.soundBasenameFor("rec_123"), "potp-challenge-rec_123");
  });

  it("has no media manifest without Spaces and a manifest secret configured", async () => {
    const service = new ChallengeService(fakeDb, config, undefined);
    assert.equal(await service.currentManifest(), undefined);
  });
});
