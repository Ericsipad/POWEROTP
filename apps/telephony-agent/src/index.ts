import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { ControlPlaneAuthError, fetchNodeConfig } from "./control-plane-client.js";
import { loadAgentConfig } from "./config.js";
import { renderPjsipTrunks } from "./pjsip-config.js";

const run = promisify(execFile);
const config = loadAgentConfig();
let lastRenderedConfig: string | undefined;

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ service: "powerotp-telephony-agent", msg, ...extra }));
}

/**
 * Local ARI control and VoIP.ms dialplan/call-control logic are still
 * ahead (Phase 4, see `docs/PLAN.md`). This process currently:
 * authenticates to the control plane with the shared `NODE_SECRET`,
 * renders any configured outbound trunks into a local PJSIP include
 * file, and asks a running Asterisk to reload PJSIP so new or changed
 * trunk credentials take effect on the next poll — including the very
 * first one, right after the process starts. It only writes the file and
 * reloads when the rendered config actually changed, so an unattended
 * node doesn't reload Asterisk every poll interval for no reason.
 */
async function syncOnce() {
  const nodeConfig = await fetchNodeConfig(config);
  const configuredTypes = Object.entries(nodeConfig.trunks)
    .filter(([, trunk]) => Boolean(trunk))
    .map(([type]) => type);
  log("fetched node config", { configuredTypes });

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

async function loop() {
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

log("starting", { controlPlaneUrl: config.CONTROL_PLANE_URL });
void loop();
