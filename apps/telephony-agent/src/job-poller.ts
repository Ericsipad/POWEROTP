import type { AriClient } from "./ari-client.js";
import type { AgentConfig } from "./config.js";
import { fetchNextJob, reportJobEvent } from "./control-plane-client.js";
import { placeReachabilityCall } from "./reachability-call.js";
import { isProviderLevelFailure, TrunkPool } from "./trunk-pool.js";
import { placeVoiceChallengeCall } from "./voice-challenge-call.js";
import { placeVoiceCodeCall } from "./voice-code-call.js";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;
type ReportableState = "ringing" | "answered" | "playing" | "succeeded" | "failed";

/**
 * The types this agent actually knows how to execute once claimed. Any
 * trunk in the pool can serve any of these — extending call control to a
 * new type is adding an entry here plus its own `place*Call` module;
 * everything else (claim, trunk selection/retry, report, error handling)
 * is already generic.
 */
const knownVoiceTypes = ["call_reachability", "voice_code", "voice_challenge"] as const;

/**
 * Polls for at most one claimable job — trying each type this node has at
 * least one trunk configured for, in turn — and runs it to completion
 * before the caller polls again; a droplet handles calls serially for now
 * (see `docs/AS_BUILT.md`'s "Known gaps" for concurrency). Skips call
 * dispatch entirely when the node has no trunk configured at all, or the
 * local ARI WebSocket isn't connected yet (claiming a job we can't
 * receive events for would just run out the clock).
 */
export async function pollAndRunOneJob(
  config: AgentConfig,
  ari: AriClient,
  configuredTypes: ReadonlySet<string>,
  log: Logger,
  trunkPool: TrunkPool = new TrunkPool(),
): Promise<void> {
  if (!ari.isOpen()) return;

  for (const type of knownVoiceTypes) {
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
    // this job — across every trunk attempt below — through one promise,
    // so each is fully applied before the next is even sent, makes that
    // race impossible.
    let reportChain: Promise<unknown> = Promise.resolve();
    const report = (state: ReportableState, reasonCode?: string) => {
      reportChain = reportChain.then(() =>
        reportJobEvent(config, job.interactionId, state, reasonCode).catch((error: unknown) =>
          log("failed to report call progress", { interactionId: job.interactionId, error: errorMessage(error) }),
        ),
      );
    };

    const result = await runJobWithFailover(ari, trunkPool, job, config, report, log);
    await reportChain;

    try {
      const outcome = await reportJobEvent(
        config,
        job.interactionId,
        result.state,
        result.reasonCode,
        result.trunkId,
      );
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

/**
 * Tries the job against every currently-healthy trunk, in the pool's
 * rotation order, until one attempt either succeeds/reaches
 * `awaiting_response` or every healthy trunk has been tried once. A
 * provider-level failure on one trunk (per `isProviderLevelFailure`)
 * immediately retries the same job on the next healthy trunk instead of
 * waiting for the next poll cycle — the literal "if any number appears
 * down, it just uses the next number" behavior, applied within one
 * verification attempt. A legitimate destination-side outcome (busy,
 * no_answer, invalid_number) is not retried on another trunk: it's not
 * the trunk's fault, and trying again would just annoy the same
 * recipient a second time. `reportOutcome` is called after every attempt
 * so the pool's health tracking stays accurate regardless of how the job
 * as a whole resolves.
 */
async function runJobWithFailover(
  ari: AriClient,
  trunkPool: TrunkPool,
  job: { type: string; targetNumber: string; code?: string; soundBasename?: string },
  config: AgentConfig,
  report: (state: ReportableState) => void,
  log: Logger,
): Promise<{
  state: "succeeded" | "failed" | "awaiting_response";
  reasonCode: string;
  /** Which trunk actually produced this outcome — absent when zero trunks
   * were healthy enough to even attempt the job (`method_not_available`). */
  trunkId?: string;
}> {
  const healthyTrunks = trunkPool.pickHealthyTrunks();
  if (healthyTrunks.length === 0) {
    return { state: "failed", reasonCode: "method_not_available" };
  }

  let lastResult: { state: "succeeded" | "failed" | "awaiting_response"; reasonCode: string } = {
    state: "failed",
    reasonCode: "method_not_available",
  };
  let lastTrunkId: string | undefined;

  for (const trunkId of healthyTrunks) {
    lastResult = await runJob(ari, trunkId, job, config, report);
    lastTrunkId = trunkId;
    trunkPool.reportOutcome(trunkId, lastResult.reasonCode);

    if (lastResult.state !== "failed" || !isProviderLevelFailure(lastResult.reasonCode)) {
      return { ...lastResult, trunkId };
    }

    log("provider-level failure on trunk; retrying on the next healthy trunk", {
      trunkId,
      reasonCode: lastResult.reasonCode,
    });
  }

  return { ...lastResult, trunkId: lastTrunkId };
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
