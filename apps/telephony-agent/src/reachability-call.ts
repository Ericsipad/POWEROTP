import type { AriClient } from "./ari-client.js";
import { originateAndWaitForAnswer } from "./originate-call.js";

export interface ReachabilityResult {
  state: "succeeded" | "failed";
  reasonCode: string;
}

/**
 * Places one outbound call for `call_reachability`: it only needs to know
 * whether the destination answered, so it hangs up immediately once that's
 * known either way.
 */
export async function placeReachabilityCall(
  ari: AriClient,
  trunkEndpoint: string,
  targetNumber: string,
  ringTimeoutSeconds: number,
  onProgress: (state: "ringing" | "answered") => void,
): Promise<ReachabilityResult> {
  const outcome = await originateAndWaitForAnswer(ari, trunkEndpoint, targetNumber, ringTimeoutSeconds, () =>
    onProgress("ringing"),
  );

  if (!outcome.answered) {
    return { state: "failed", reasonCode: outcome.reasonCode ?? "call_failed" };
  }

  onProgress("answered");
  await ari.hangup(outcome.channelId);
  return { state: "succeeded", reasonCode: "answered" };
}
