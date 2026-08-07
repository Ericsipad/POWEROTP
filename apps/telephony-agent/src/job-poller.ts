import type { AriClient } from "./ari-client.js";
import type { AgentConfig } from "./config.js";
import { fetchNextJob, reportJobEvent } from "./control-plane-client.js";
import { placeReachabilityCall } from "./reachability-call.js";
import { placeVoiceChallengeCall } from "./voice-challenge-call.js";
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
  voice_challenge: "trunk-voice-challenge",
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

    // Call-control code fires progress reports (ringing/answered/playing)
    // without waiting for each HTTP round-trip, since it must stay
    // responsive to ARI events. But the control plane's `transition()` is
    // optimistic-concurrency (read state+sequence, then a conditional
    // write) — if two reports for the same interaction are ever in flight
    // at once, whichever's write loses the race gets silently rejected
    // (a 409 that never throws), and a fast-answered call could strand the
    // interaction at an earlier state forever. Chaining every report for
    // this job through one promise, so each is fully applied before the
    // next is even sent, makes that race impossible.
    let reportChain: Promise<unknown> = Promise.resolve();
    const report = (state: ReportableState, reasonCode?: string) => {
      reportChain = reportChain.then(() =>
        reportJobEvent(config, job.interactionId, state, reasonCode).catch((error: unknown) =>
          log("failed to report call progress", { interactionId: job.interactionId, error: errorMessage(error) }),
        ),
      );
    };

    const result = await runJob(ari, trunkEndpoint, job, config, report);
    await reportChain;

    try {
      const outcome = await reportJobEvent(config, job.interactionId, result.state, result.reasonCode);
      if (!outcome.applied) {
        log("call result report was rejected as stale", { interactionId: job.interactionId, ...result });
      }
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
  job: { type: string; targetNumber: string; code?: string; soundBasename?: string },
  config: AgentConfig,
  report: (state: ReportableState) => void,
): Promise<{ state: "succeeded" | "failed" | "awaiting_response"; reasonCode: string }> {
  const ringTimeoutSeconds = config.CALL_RING_TIMEOUT_SECONDS;
  if (job.type === "voice_code") {
    if (!job.code) return { state: "failed", reasonCode: "node_error" };
    return placeVoiceCodeCall(ari, trunkEndpoint, job.targetNumber, job.code, ringTimeoutSeconds, report);
  }
  if (job.type === "voice_challenge") {
    if (!job.soundBasename) return { state: "failed", reasonCode: "node_error" };
    const media = `sound:${config.MEDIA_SOUND_PREFIX}/${job.soundBasename}`;
    return placeVoiceChallengeCall(ari, trunkEndpoint, job.targetNumber, media, ringTimeoutSeconds, report);
  }
  return placeReachabilityCall(ari, trunkEndpoint, job.targetNumber, ringTimeoutSeconds, report);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
