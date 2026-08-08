import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { AriClient } from "./ari-client.js";
import { ControlPlaneAuthError, fetchNodeConfig } from "./control-plane-client.js";
import { loadAgentConfig } from "./config.js";
import { pollAndRunOneJob } from "./job-poller.js";
import { syncMediaOnce } from "./media-sync.js";
import { renderPjsipTrunks } from "./pjsip-config.js";
import { TrunkPool } from "./trunk-pool.js";

const run = promisify(execFile);
const config = loadAgentConfig();
let lastRenderedConfig: string | undefined;
// Every voice type is "configured" as soon as at least one trunk exists in
// the pool — any trunk can serve any of the three voice methods now (see
// docs/AS_BUILT.md's "Outbound trunk pool" section), so this is no longer
// a per-type set keyed by trunk identity, just "is the pool non-empty".
let configuredTypes = new Set<string>();
const trunkPool = new TrunkPool();

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ service: "powerotp-telephony-agent", msg, ...extra }));
}

const voiceVerificationTypes = ["call_reachability", "voice_code", "voice_challenge"] as const;

/**
 * Renders any configured outbound trunks into a local PJSIP include file
 * and asks a running Asterisk to reload PJSIP so new or changed trunk
 * credentials take effect on the next poll — including the very first one,
 * right after the process starts. It only writes the file and reloads when
 * the rendered config actually changed, so an unattended node doesn't
 * reload Asterisk every poll interval for no reason. Also refreshes the
 * shared `TrunkPool` with the current trunk id list, so a trunk added or
 * removed in App Platform takes effect within one poll cycle, no restart
 * needed. `configuredTypes` (now just "is the pool non-empty", since any
 * trunk can serve any voice type) is the set `jobLoop` consults so it
 * never polls for job types this node has no trunk to actually dial with.
 */
async function syncOnce() {
  const nodeConfig = await fetchNodeConfig(config);
  trunkPool.updateTrunkIds(nodeConfig.trunks.map((trunk) => trunk.id));
  configuredTypes = nodeConfig.trunks.length > 0 ? new Set(voiceVerificationTypes) : new Set();
  log("fetched node config", {
    configuredTypes: [...configuredTypes],
    trunkIds: nodeConfig.trunks.map((trunk) => trunk.id),
  });

  if (!config.ASTERISK_PJSIP_TRUNKS_PATH) return;

  const rendered = renderPjsipTrunks(nodeConfig);
  if (rendered === lastRenderedConfig) return;

  await writeFile(config.ASTERISK_PJSIP_TRUNKS_PATH, rendered, "utf8");
  try {
    await run("asterisk", ["-rx", "pjsip reload"]);
    lastRenderedConfig = rendered;
    log("trunk configuration changed; reloaded pjsip");
  } catch (error) {
    log("pjsip reload failed", { error: error instanceof Error ? error.message : "unknown" });
  }
}

async function configLoop() {
  for (;;) {
    try {
      await syncOnce();
    } catch (error) {
      if (error instanceof ControlPlaneAuthError) {
        log("NODE_SECRET rejected by the control plane; check it matches App Platform");
      } else {
        log("config sync failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
  }
}

/**
 * Separate, much faster loop than `configLoop`: call dispatch needs to
 * happen promptly, not once a minute. Deliberately processes at most one
 * call at a time (see `job-poller.ts`).
 */
async function jobLoop(ari: AriClient) {
  for (;;) {
    try {
      await pollAndRunOneJob(config, ari, configuredTypes, log, trunkPool);
    } catch (error) {
      if (error instanceof ControlPlaneAuthError) {
        log("NODE_SECRET rejected by the control plane; check it matches App Platform");
      } else {
        log("job poll failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.JOB_POLL_INTERVAL_MS));
  }
}

/**
 * Independent poll loop for `voice_challenge` recordings — separate from
 * `configLoop` since media rarely changes and downloads can take longer
 * than a trunk-config fetch; see `media-sync.ts`. No-ops entirely on a
 * droplet without `MEDIA_ROOT`/`MEDIA_MANIFEST_SECRET` configured.
 */
async function mediaLoop() {
  for (;;) {
    try {
      await syncMediaOnce(config, log);
    } catch (error) {
      log("media sync failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    await new Promise((resolve) => setTimeout(resolve, config.MEDIA_POLL_INTERVAL_MS));
  }
}

log("starting", { controlPlaneUrl: config.CONTROL_PLANE_URL });
const ari = new AriClient(config.ARI_URL, config.ARI_USER, config.ARI_PASS, "powerotp-reachability");
ari.connect();
void configLoop();
void jobLoop(ari);
void mediaLoop();
