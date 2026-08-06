import type { AriClient } from "./ari-client.js";
import type { AgentConfig } from "./config.js";
import { fetchNextJob, reportJobEvent } from "./control-plane-client.js";
import { placeReachabilityCall } from "./reachability-call.js";
import { placeVoiceCodeCall } from "./voice-code-call.js";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;
type ReportableState = "ringing" | "answered" | "playing" | "succeeded" | "failed";

/**
 * The types this agent actually knows how to execute once claimed, and how
 * to dial each one's endpoint (matching the naming
 * `apps/telephony-agent/src/pjsip-config.ts` renders). Extending call
 * control to a new type is adding an entry here plus its own
 * `place*Call` module — everything else (claim, report, error handling) is
 * already generic.
 */
const trunkEndpointByType: Record<string, string> = {
  call_reachability: "trunk-call-reachability",
  voice_code: "trunk-voice-code",
};

/**
 * Polls for at most one claimable job — trying each type this node has a
 * trunk for in turn — and runs it to completion before the caller polls
 * again; a droplet handles calls serially for now (see `docs/AS_BUILT.md`'s
 * "Known gaps" for concurrency). Skips a type entirely when the node has no
 * trunk configured for it (nothing to dial with) or the local ARI WebSocket
 * isn't connected yet (claiming a job we can't receive events for would
 * just run out the clock to `node_timeout`).
 */
export async function pollAndRunOneJob(
  config: AgentConfig,
  ari: AriClient,
  configuredTypes: ReadonlySet<string>,
  log: Logger,
): Promise<void> {
  if (!ari.isOpen()) return;

  for (const [type, trunkEndpoint] of Object.entries(trunkEndpointByType)) {
    if (!configuredTypes.has(type)) continue;

    const job = await fetchNextJob(config, type);
    if (!job) continue;

    log("claimed call job", { interactionId: job.interactionId, type });
    const report = (state: ReportableState, reasonCode?: string) =>
      reportJobEvent(config, job.interactionId, state, reasonCode).catch((error: unknown) =>
        log("failed to report call progress", { interactionId: job.interactionId, error: errorMessage(error) }),
      );

    const result = await runJob(ari, trunkEndpoint, job, config.CALL_RING_TIMEOUT_SECONDS, report);

    try {
      await reportJobEvent(config, job.interactionId, result.state, result.reasonCode);
    } catch (error) {
      log("failed to report call result", { interactionId: job.interactionId, error: errorMessage(error) });
    }
    log("call job finished", { interactionId: job.interactionId, ...result });
    return;
  }
}

async function runJob(
  ari: AriClient,
  trunkEndpoint: string,
  job: { type: string; targetNumber: string; code?: string },
  ringTimeoutSeconds: number,
  report: (state: ReportableState) => void,
): Promise<{ state: "succeeded" | "failed" | "awaiting_response"; reasonCode: string }> {
  if (job.type === "voice_code") {
    if (!job.code) return { state: "failed", reasonCode: "node_error" };
    return placeVoiceCodeCall(ari, trunkEndpoint, job.targetNumber, job.code, ringTimeoutSeconds, report);
  }
  return placeReachabilityCall(ari, trunkEndpoint, job.targetNumber, ringTimeoutSeconds, report);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
