import { randomUUID } from "node:crypto";

import type { AriChannelEvent, AriClient } from "./ari-client.js";
import { originateAndWaitForAnswer } from "./originate-call.js";

/** Generous upper bound on how long a single recording playback can take,
 * so a lost `PlaybackFinished` event can't stall the job loop forever. */
const PLAYBACK_SAFETY_TIMEOUT_MS = 20_000;

export interface VoiceChallengeResult {
  state: "awaiting_response" | "failed";
  reasonCode: string;
}

/**
 * Places one outbound call for `voice_challenge`: once answered, it plays
 * the challenge's already-synced recording exactly once (see
 * `media-sync.ts`) and hangs up. Like `voice_code`, it never collects a
 * response over the phone — the customer's own UI/server submits the
 * chosen option IDs separately through the existing
 * `/v1/verifications/{id}/response` endpoint, so this resolves at
 * `awaiting_response`, not a terminal state.
 */
export async function placeVoiceChallengeCall(
  ari: AriClient,
  trunkEndpoint: string,
  targetNumber: string,
  soundMedia: string,
  ringTimeoutSeconds: number,
  onProgress: (state: "ringing" | "answered" | "playing") => void,
): Promise<VoiceChallengeResult> {
  const outcome = await originateAndWaitForAnswer(ari, trunkEndpoint, targetNumber, ringTimeoutSeconds, () =>
    onProgress("ringing"),
  );

  if (!outcome.answered) {
    return { state: "failed", reasonCode: outcome.reasonCode ?? "call_failed" };
  }

  onProgress("answered");
  onProgress("playing");
  try {
    await playAndWait(ari, outcome.channelId, soundMedia);
  } finally {
    await ari.hangup(outcome.channelId);
  }
  return { state: "awaiting_response", reasonCode: "recording_played" };
}

function playAndWait(ari: AriClient, channelId: string, media: string): Promise<void> {
  return new Promise((resolve) => {
    const playbackId = `potp-play-${randomUUID()}`;
    let settled = false;

    const timeout = setTimeout(finish, PLAYBACK_SAFETY_TIMEOUT_MS);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ari.off("event", onEvent);
      resolve();
    }

    function onEvent(event: AriChannelEvent) {
      if (event.type === "PlaybackFinished" && event.playback?.id === playbackId) finish();
    }

    ari.on("event", onEvent);
    ari.play(channelId, media, playbackId).catch(finish);
  });
}
