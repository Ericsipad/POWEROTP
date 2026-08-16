import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MediaManifestSchema, type MediaManifestAsset, type MediaManifestResponse } from "@powerotp/contracts";

import type { AgentConfig } from "./config.js";
import { fetchMediaManifest } from "./control-plane-client.js";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;
type FetchManifest = (config: AgentConfig) => Promise<MediaManifestResponse | null>;
type DownloadAsset = (url: string) => Promise<Buffer>;

async function defaultDownloadAsset(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Verifies the manifest signature independently of `backend/packages/api` — this
 * package is deployed to droplets and deliberately has no dependency on
 * the control plane's service layer or its database driver — using the
 * same signed-payload format as
 * `backend/packages/api/src/security.ts#verifySignedPayload`.
 */
function verifyManifestToken(token: string, secret: string) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) throw new Error("Malformed manifest token");

  const expected = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("Invalid manifest signature");
  }

  return MediaManifestSchema.parse(
    JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
  );
}

async function ensureAsset(
  mediaRoot: string,
  asset: MediaManifestAsset,
  url: string,
  downloadAsset: DownloadAsset,
  log: Logger,
): Promise<void> {
  const finalPath = join(mediaRoot, `${asset.soundBasename}.wav`);
  const existing = await readFile(finalPath).catch(() => undefined);
  if (existing && createHash("sha256").update(existing).digest("hex") === asset.sha256) {
    return; // already installed and unchanged
  }

  const buffer = await downloadAsset(url);
  if (createHash("sha256").update(buffer).digest("hex") !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.assetId}`);
  }

  const tempPath = join(mediaRoot, `.tmp-${asset.assetId}`);
  await writeFile(tempPath, buffer);
  await rename(tempPath, finalPath); // atomic on the same filesystem
  log("synced recording", { assetId: asset.assetId, soundBasename: asset.soundBasename });
}

async function pruneOrphans(
  mediaRoot: string,
  assets: readonly MediaManifestAsset[],
  log: Logger,
): Promise<void> {
  const expectedFiles = new Set(assets.map((asset) => `${asset.soundBasename}.wav`));
  const entries = await readdir(mediaRoot).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry.startsWith(".tmp-") || expectedFiles.has(entry)) continue;
    await rm(join(mediaRoot, entry), { force: true });
    log("removed orphaned recording", { entry });
  }
}

/**
 * Polls the signed media manifest and keeps the local recordings
 * directory in sync: downloads and checksum-verifies anything missing or
 * changed, then removes any locally installed recording the manifest no
 * longer references (its challenge, or the recording itself, was
 * retired). No-ops entirely when `MEDIA_ROOT`/`MEDIA_MANIFEST_SECRET` are
 * unset, or the control plane has nothing published yet — the same
 * "not configured, so nothing to do" convention as the PJSIP trunk sync.
 */
export async function syncMediaOnce(
  config: AgentConfig,
  log: Logger,
  fetchManifest: FetchManifest = fetchMediaManifest,
  downloadAsset: DownloadAsset = defaultDownloadAsset,
): Promise<void> {
  if (!config.MEDIA_ROOT || !config.MEDIA_MANIFEST_SECRET) return;

  const response = await fetchManifest(config);
  if (!response) return;

  const manifest = verifyManifestToken(response.manifestToken, config.MEDIA_MANIFEST_SECRET);
  await mkdir(config.MEDIA_ROOT, { recursive: true });

  for (const asset of manifest.assets) {
    const url = response.downloadUrls[asset.assetId];
    if (!url) continue;
    try {
      await ensureAsset(config.MEDIA_ROOT, asset, url, downloadAsset, log);
    } catch (error) {
      log("media sync failed for asset", {
        assetId: asset.assetId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  await pruneOrphans(config.MEDIA_ROOT, manifest.assets, log);
}
