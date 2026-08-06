import {
  NodeConfigSchema,
  NodeJobSchema,
  type NodeConfig,
  type NodeJob,
  type reportableNodeJobStates,
} from "@powerotp/contracts";

import type { AgentConfig } from "./config.js";

export class ControlPlaneAuthError extends Error {}

function authHeaders(config: AgentConfig): HeadersInit {
  return { authorization: `Bearer ${config.NODE_SECRET}` };
}

/**
 * Fetches this node's outbound trunk configuration. A 401 means
 * `NODE_SECRET` doesn't match what App Platform currently has configured
 * (never set, or rotated) and is treated as a distinct condition so the
 * agent can log it clearly instead of retrying an authentication failure
 * indefinitely with the same noisy error.
 */
export async function fetchNodeConfig(config: AgentConfig): Promise<NodeConfig> {
  const response = await fetch(new URL("/v1/nodes/config", config.CONTROL_PLANE_URL), {
    headers: authHeaders(config),
  });

  if (response.status === 401) {
    throw new ControlPlaneAuthError("Node secret was rejected by the control plane");
  }
  if (!response.ok) {
    throw new Error(`Control plane returned ${response.status}`);
  }

  return NodeConfigSchema.parse(await response.json());
}

/**
 * Claims the next `dispatching` interaction of `type`, if any. `204` (no
 * body) means nothing is currently waiting — this is the normal, frequent
 * case, not an error.
 */
export async function fetchNextJob(config: AgentConfig, type: string): Promise<NodeJob | null> {
  const url = new URL("/v1/nodes/jobs/next", config.CONTROL_PLANE_URL);
  url.searchParams.set("type", type);
  const response = await fetch(url, { headers: authHeaders(config) });

  if (response.status === 204) return null;
  if (response.status === 401) {
    throw new ControlPlaneAuthError("Node secret was rejected by the control plane");
  }
  if (!response.ok) {
    throw new Error(`Control plane returned ${response.status}`);
  }
  return NodeJobSchema.parse(await response.json());
}

/**
 * Reports call progress or a final result for a previously claimed job.
 * `409` means the interaction already moved on (e.g. the global interaction
 * timeout expired it first) — logged by the caller, not thrown, since it is
 * an expected race, not an agent bug.
 */
export async function reportJobEvent(
  config: AgentConfig,
  interactionId: string,
  state: (typeof reportableNodeJobStates)[number],
  reasonCode?: string,
): Promise<{ applied: boolean }> {
  const response = await fetch(
    new URL(`/v1/nodes/jobs/${interactionId}/events`, config.CONTROL_PLANE_URL),
    {
      method: "POST",
      headers: { ...authHeaders(config), "content-type": "application/json" },
      body: JSON.stringify({ state, reasonCode }),
    },
  );

  if (response.status === 401) {
    throw new ControlPlaneAuthError("Node secret was rejected by the control plane");
  }
  if (response.status === 409) return { applied: false };
  if (!response.ok) {
    throw new Error(`Control plane returned ${response.status}`);
  }
  return { applied: true };
}
