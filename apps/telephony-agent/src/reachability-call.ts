import { randomUUID } from "node:crypto";

import type { AriChannelEvent, AriClient } from "./ari-client.js";

/**
 * Q.850 hangup causes Asterisk reports on `ChannelDestroyed`, mapped to the
 * small, stable reason-code vocabulary the dashboard/callbacks use. See
 * `docs/MVP_ACCEPTANCE.md` Type 1: "Answered, busy, no-answer, rejected,
 * invalid, canceled, and timeout calls map consistently."
 */
const causeReasonCode: Record<number, string> = {
  1: "invalid_number", // Unallocated number
  17: "busy", // User busy
  18: "no_answer", // No user responding
  19: "no_answer", // No answer from user (alerted)
  21: "call_rejected", // Call rejected
  27: "invalid_number", // Destination out of order
  28: "invalid_number", // Invalid number format
  34: "provider_unavailable", // No circuit/channel available
  38: "provider_unavailable", // Network out of order
};

export function reasonCodeForHangupCause(cause: number | undefined): string {
  return causeReasonCode[cause ?? -1] ?? "call_failed";
}

export interface ReachabilityResult {
  state: "succeeded" | "failed";
  reasonCode: string;
}

/**
 * Places one outbound call for `call_reachability` and resolves once a
 * final answered/failed outcome is known, reporting intermediate progress
 * through `onProgress` as it happens. The channel ID is generated locally
 * (instead of trusting the one ARI's originate response would return) so
 * event filtering can start before the HTTP response comes back — closing
 * the race where a fast busy/reject event could otherwise arrive over the
 * WebSocket before we knew which channel ID to watch for.
 */
export function placeReachabilityCall(
  ari: AriClient,
  trunkEndpoint: string,
  targetNumber: string,
  ringTimeoutSeconds: number,
  onProgress: (state: "ringing" | "answered") => void,
): Promise<ReachabilityResult> {
  return new Promise((resolve) => {
    const channelId = `potp-${randomUUID()}`;
    let reportedRinging = false;
    let settled = false;

    const hardTimeout = setTimeout(
      () => finish({ state: "failed", reasonCode: "node_timeout" }),
      (ringTimeoutSeconds + 15) * 1_000,
    );

    function finish(result: ReachabilityResult) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      ari.off("event", onEvent);
      void ari.hangup(channelId);
      resolve(result);
    }

    function onEvent(event: AriChannelEvent) {
      if (event.channel?.id !== channelId) return;

      if (event.type === "ChannelStateChange" && event.channel?.state === "Ringing") {
        reportedRinging = true;
        onProgress("ringing");
        return;
      }

      if (event.type === "StasisStart") {
        if (!reportedRinging) onProgress("ringing");
        onProgress("answered");
        finish({ state: "succeeded", reasonCode: "answered" });
        return;
      }

      if (event.type === "ChannelDestroyed") {
        finish({ state: "failed", reasonCode: reasonCodeForHangupCause(event.cause) });
      }
    }

    ari.on("event", onEvent);

    ari
      .originate(`PJSIP/${targetNumber}@${trunkEndpoint}`, channelId, ringTimeoutSeconds)
      .catch(() => finish({ state: "failed", reasonCode: "originate_failed" }));
  });
}
