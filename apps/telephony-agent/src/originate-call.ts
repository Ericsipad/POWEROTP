import { randomUUID } from "node:crypto";

import type { AriChannelEvent, AriClient } from "./ari-client.js";
import { reasonCodeForHangupCause } from "./hangup-causes.js";

export interface OriginateOutcome {
  answered: boolean;
  channelId: string;
  /** Only set when `answered` is false. */
  reasonCode?: string;
}

/**
 * Shared by every call-control flow that starts with "dial out and see if
 * it's answered" (`call_reachability`, `voice_code`, ...) — what happens
 * next differs per method, but getting to "answered" or "why not" is
 * identical. The channel ID is generated locally (instead of trusting the
 * one ARI's originate response would return) so event filtering can start
 * before the HTTP response comes back — closing the race where a fast
 * busy/reject event could otherwise arrive over the WebSocket before we
 * knew which channel ID to watch for.
 */
export function originateAndWaitForAnswer(
  ari: AriClient,
  trunkEndpoint: string,
  targetNumber: string,
  ringTimeoutSeconds: number,
  onRinging: () => void,
): Promise<OriginateOutcome> {
  return new Promise((resolve) => {
    const channelId = `potp-${randomUUID()}`;
    let ranOnRinging = false;
    let settled = false;

    const hardTimeout = setTimeout(
      () => finish({ answered: false, channelId, reasonCode: "node_timeout" }),
      (ringTimeoutSeconds + 15) * 1_000,
    );

    function finish(outcome: OriginateOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      ari.off("event", onEvent);
      // Only auto-hangup when the call never answered (timeout/destroyed):
      // an answered channel is handed to the caller, which owns hanging it
      // up once it has done whatever it needed the live channel for.
      if (!outcome.answered) void ari.hangup(channelId);
      resolve(outcome);
    }

    function ring() {
      if (ranOnRinging) return;
      ranOnRinging = true;
      onRinging();
    }

    function onEvent(event: AriChannelEvent) {
      if (event.channel?.id !== channelId) return;

      if (event.type === "ChannelStateChange" && event.channel?.state === "Ringing") {
        ring();
        return;
      }

      if (event.type === "StasisStart") {
        ring();
        finish({ answered: true, channelId });
        return;
      }

      if (event.type === "ChannelDestroyed") {
        finish({ answered: false, channelId, reasonCode: reasonCodeForHangupCause(event.cause) });
      }
    }

    ari.on("event", onEvent);

    ari
      .originate(`PJSIP/${targetNumber}@${trunkEndpoint}`, channelId, ringTimeoutSeconds)
      .catch(() => finish({ answered: false, channelId, reasonCode: "originate_failed" }));
  });
}
