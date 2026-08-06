import { NodeConfigSchema, type NodeConfig } from "@powerotp/contracts";

import type { AgentConfig } from "./config.js";

export class ControlPlaneAuthError extends Error {}

/**
 * Fetches this node's outbound trunk configuration. A 401 means
 * `NODE_SECRET` doesn't match what App Platform currently has configured
 * (never set, or rotated) and is treated as a distinct condition so the
 * agent can log it clearly instead of retrying an authentication failure
 * indefinitely with the same noisy error.
 */
export async function fetchNodeConfig(config: AgentConfig): Promise<NodeConfig> {
  const response = await fetch(new URL("/v1/nodes/config", config.CONTROL_PLANE_URL), {
    headers: { authorization: `Bearer ${config.NODE_SECRET}` },
  });

  if (response.status === 401) {
    throw new ControlPlaneAuthError("Node secret was rejected by the control plane");
  }
  if (!response.ok) {
    throw new Error(`Control plane returned ${response.status}`);
  }

  return NodeConfigSchema.parse(await response.json());
}
