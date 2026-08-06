import type { AriClient } from "./ari-client.js";
import type { AgentConfig } from "./config.js";
import { fetchNextJob, reportJobEvent } from "./control-plane-client.js";
import { placeReachabilityCall } from "./reachability-call.js";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * Polls for at most one claimable `call_reachability` job and runs it to
 * completion before the caller polls again — a droplet handles calls
 * serially for now (see `docs/AS_BUILT.md`'s "Known gaps" for concurrency).
 * Skips polling entirely when the node has no `call_reachability` trunk
 * configured (nothing to dial with) or the local ARI WebSocket isn't
 * connected yet (claiming a job we can't receive events for would just run
 * out the clock to `node_timeout`).
 */
export async function pollAndRunOneJob(
  config: AgentConfig,
  ari: AriClient,
  configuredTypes: ReadonlySet<string>,
  log: Logger,
): Promise<void> {
  if (!configuredTypes.has("call_reachability") || !ari.isOpen()) return;

  const job = await fetchNextJob(config, "call_reachability");
  if (!job) return;

  log("claimed call job", { interactionId: job.interactionId });

  const result = await placeReachabilityCall(
    ari,
    "trunk-call-reachability",
    job.targetNumber,
    config.CALL_RING_TIMEOUT_SECONDS,
    (state) => {
      void reportJobEvent(config, job.interactionId, state).catch((error: unknown) =>
        log("failed to report call progress", { error: errorMessage(error) }),
      );
    },
  );

  try {
    await reportJobEvent(config, job.interactionId, result.state, result.reasonCode);
  } catch (error) {
    log("failed to report call result", { error: errorMessage(error) });
  }
  log("call job finished", { interactionId: job.interactionId, ...result });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
