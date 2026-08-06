import { NodeConfigSchema, type NodeConfig } from "@powerotp/contracts";

import type { AgentConfig } from "./config.js";

export class ControlPlaneAuthError extends Error {}

/**
 * Fetches this node's assigned outbound trunk configuration. A 401 means
 * the secret was rejected (never enrolled, or revoked from `/admin`) and
 * is treated as a distinct, non-retryable-forever condition so the agent
 * can log it clearly instead of retrying an authentication failure
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
