import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { MediaManifest, MediaManifestResponse } from "@powerotp/contracts";

import type { AgentConfig } from "./config.js";
import { syncMediaOnce } from "./media-sync.js";

const SECRET = "manifest-signing-secret-with-32-plus-characters";

/** Mirrors `backend/packages/api/src/security.ts#signPayload` — see `media-sync.ts`'s
 * comment on why this package intentionally re-implements verification
 * rather than depending on the control plane's service layer. */
function signManifest(manifest: MediaManifest, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function baseConfig(mediaRoot: string): AgentConfig {
  return {
    NODE_SECRET: "n".repeat(32),
    CONTROL_PLANE_URL: "https://powerotp.example",
    ARI_URL: "http://127.0.0.1:8088",
    ARI_USER: "agent",
    ARI_PASS: "secret",
    POLL_INTERVAL_MS: 60_000,
    JOB_POLL_INTERVAL_MS: 2_000,
    CALL_RING_TIMEOUT_SECONDS: 30,
    MEDIA_MANIFEST_SECRET: SECRET,
    MEDIA_ROOT: mediaRoot,
    MEDIA_SOUND_PREFIX: "custom/potp",
    MEDIA_POLL_INTERVAL_MS: 60_000,
  };
}

describe("syncMediaOnce", () => {
  it("downloads, checksum-verifies, and installs a new asset", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "potp-media-test-"));
    try {
      const audio = Buffer.from("fake audio bytes");
      const manifest: MediaManifest = {
        manifestVersion: 1,
        issuedAt: new Date().toISOString(),
        assets: [
          {
            assetId: "rec_0000000000000001",
            sha256: createHash("sha256").update(audio).digest("hex"),
            durationMs: 1_000,
            soundBasename: "potp-challenge-rec_1",
          },
        ],
      };
      const response: MediaManifestResponse = {
        manifestToken: signManifest(manifest, SECRET),
        downloadUrls: { rec_0000000000000001: "https://spaces.example/rec_1" },
      };

      const logs: string[] = [];
      await syncMediaOnce(
        baseConfig(mediaRoot),
        (msg) => logs.push(msg),
        async () => response,
        async () => audio,
      );

      const installed = await readFile(join(mediaRoot, "potp-challenge-rec_1.wav"));
      assert.deepEqual(installed, audio);
      assert.ok(logs.includes("synced recording"));
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("removes a locally installed recording no longer in the manifest", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "potp-media-test-"));
    try {
      await writeFile(join(mediaRoot, "potp-challenge-retired.wav"), "stale");
      const manifest: MediaManifest = {
        manifestVersion: 2,
        issuedAt: new Date().toISOString(),
        assets: [],
      };
      const response: MediaManifestResponse = {
        manifestToken: signManifest(manifest, SECRET),
        downloadUrls: {},
      };

      await syncMediaOnce(
        baseConfig(mediaRoot),
        () => undefined,
        async () => response,
        async () => Buffer.alloc(0),
      );

      assert.deepEqual(await readdir(mediaRoot), []);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("rejects a manifest with an invalid signature without installing anything", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "potp-media-test-"));
    try {
      const manifest: MediaManifest = { manifestVersion: 1, issuedAt: new Date().toISOString(), assets: [] };
      const tampered = signManifest(manifest, SECRET).replace(/.$/, "x");

      await assert.rejects(
        syncMediaOnce(
          baseConfig(mediaRoot),
          () => undefined,
          async () => ({ manifestToken: tampered, downloadUrls: {} }),
          async () => Buffer.alloc(0),
        ),
      );
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("does nothing when MEDIA_ROOT/MEDIA_MANIFEST_SECRET are unset", async () => {
    let called = false;
    await syncMediaOnce(
      { ...baseConfig("/tmp/unused"), MEDIA_ROOT: undefined },
      () => undefined,
      async () => {
        called = true;
        return null;
      },
      async () => Buffer.alloc(0),
    );
    assert.equal(called, false);
  });
});
