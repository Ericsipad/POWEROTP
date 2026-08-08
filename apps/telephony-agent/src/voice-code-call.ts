import { randomUUID } from "node:crypto";

import type { AriChannelEvent, AriClient } from "./ari-client.js";
import { originateAndWaitForAnswer } from "./originate-call.js";

/**
 * How many times the code is spoken before hanging up. `docs/PROVIDER_CHECKLIST.md`
 * lists "playback repetitions" as a limit to confirm before public launch;
 * this is a reasonable default until that policy is formally set.
 */
const CODE_REPEAT_COUNT = 2;

/**
 * Silent gap between repetitions. Without this, playing the five digits
 * twice back-to-back in one ARI playback (`digits:12345,digits:12345`)
 * sounds like ten digits in a row with no way to tell where the first
 * repetition ends and the second begins — live-reported by the user.
 * Fixed by issuing each repetition as its own ARI playback and waiting
 * out this real silence between them (the call stays connected, just
 * silent) instead of relying on any Asterisk-specific "silence" media
 * type, which keeps this correct without depending on ARI/Asterisk
 * version-specific media URI support.
 */
const PAUSE_BETWEEN_REPEATS_MS = 2_000;

/** Generous upper bound on how long a single five-digit playback can take,
 * so a lost `PlaybackFinished` event can't stall the job loop forever. */
const SINGLE_PLAYBACK_SAFETY_TIMEOUT_MS = 10_000;

export interface VoiceCodeResult {
  state: "awaiting_response" | "failed";
  reasonCode: string;
}

/**
 * Places one outbound call for `voice_code`: once answered, it speaks the
 * five-digit code (as digits, repeated, with a pause between repetitions)
 * and hangs up. It never collects a response over the phone — the
 * customer's own UI/server submits the code separately through the
 * existing `/v1/verifications/{id}/response` endpoint, which is why this
 * resolves at `awaiting_response`, not a terminal state.
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

async function playCodeAndWait(ari: AriClient, channelId: string, code: string): Promise<void> {
  for (let repeat = 0; repeat < CODE_REPEAT_COUNT; repeat += 1) {
    await playOnceAndWait(ari, channelId, `digits:${code}`);
    if (repeat < CODE_REPEAT_COUNT - 1) {
      await sleep(PAUSE_BETWEEN_REPEATS_MS);
    }
  }
}

function playOnceAndWait(ari: AriClient, channelId: string, media: string): Promise<void> {
  return new Promise((resolve) => {
    const playbackId = `potp-play-${randomUUID()}`;
    let settled = false;

    const timeout = setTimeout(finish, SINGLE_PLAYBACK_SAFETY_TIMEOUT_MS);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
