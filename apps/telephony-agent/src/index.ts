import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { ControlPlaneAuthError, fetchNodeConfig } from "./control-plane-client.js";
import { loadAgentConfig } from "./config.js";
import { renderPjsipTrunks } from "./pjsip-config.js";

const run = promisify(execFile);
const config = loadAgentConfig();

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ service: "powerotp-telephony-agent", msg, ...extra }));
}

/**
 * Node enrollment/identity, local ARI control, and VoIP.ms trunk routing
 * are Phase 4 (see `docs/PLAN.md`). This process currently: authenticates
 * to the control plane, renders any configured outbound trunks into a
 * local PJSIP include file, and asks a running Asterisk to reload PJSIP
 * so new or changed trunk credentials take effect without a restart.
 * Dialplan/ARI call-control logic is added once at least one real trunk
 * is live to test against.
 */
async function syncOnce() {
  const nodeConfig = await fetchNodeConfig(config);
  const configuredTypes = Object.entries(nodeConfig.trunks)
    .filter(([, trunk]) => Boolean(trunk))
    .map(([type]) => type);
  log("fetched node config", { nodeId: nodeConfig.nodeId, configuredTypes });

  if (!config.ASTERISK_PJSIP_TRUNKS_PATH) return;

  await writeFile(config.ASTERISK_PJSIP_TRUNKS_PATH, renderPjsipTrunks(nodeConfig), "utf8");
  try {
    await run("asterisk", ["-rx", "pjsip reload"]);
    log("reloaded pjsip");
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
        log("node secret rejected; check /admin for revocation");
      } else {
        log("config sync failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
  }
}

log("starting", { controlPlaneUrl: config.CONTROL_PLANE_URL });
void loop();
