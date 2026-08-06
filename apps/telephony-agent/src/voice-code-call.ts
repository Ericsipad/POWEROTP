import { randomUUID } from "node:crypto";

import type { AriChannelEvent, AriClient } from "./ari-client.js";
import { originateAndWaitForAnswer } from "./originate-call.js";

/**
 * How many times the code is spoken before hanging up. `docs/PROVIDER_CHECKLIST.md`
 * lists "playback repetitions" as a limit to confirm before public launch;
 * this is a reasonable default until that policy is formally set.
 */
const CODE_REPEAT_COUNT = 2;

/** Generous upper bound on how long a two-repetition five-digit playback can
 * take, so a lost `PlaybackFinished` event can't stall the job loop forever. */
const PLAYBACK_SAFETY_TIMEOUT_MS = 20_000;

export interface VoiceCodeResult {
  state: "awaiting_response" | "failed";
  reasonCode: string;
}

/**
 * Places one outbound call for `voice_code`: once answered, it speaks the
 * five-digit code (as digits, repeated) and hangs up. It never collects a
 * response over the phone — the customer's own UI/server submits the code
 * separately through the existing `/v1/verifications/{id}/response`
 * endpoint, which is why this resolves at `awaiting_response`, not a
 * terminal state.
 */
export async function placeVoiceCodeCall(
  ari: AriClient,
  trunkEndpoint: string,
  targetNumber: string,
  code: string,
  ringTimeoutSeconds: number,
  onProgress: (state: "ringing" | "answered" | "playing") => void,
): Promise<VoiceCodeResult> {
  const outcome = await originateAndWaitForAnswer(ari, trunkEndpoint, targetNumber, ringTimeoutSeconds, () =>
    onProgress("ringing"),
  );

  if (!outcome.answered) {
    return { state: "failed", reasonCode: outcome.reasonCode ?? "call_failed" };
  }

  onProgress("answered");
  onProgress("playing");
  try {
    await playCodeAndWait(ari, outcome.channelId, code);
  } finally {
    await ari.hangup(outcome.channelId);
  }
  return { state: "awaiting_response", reasonCode: "code_played" };
}

function playCodeAndWait(ari: AriClient, channelId: string, code: string): Promise<void> {
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

    const media = Array.from({ length: CODE_REPEAT_COUNT }, () => `digits:${code}`).join(",");
    ari.play(channelId, media, playbackId).catch(finish);
  });
}
