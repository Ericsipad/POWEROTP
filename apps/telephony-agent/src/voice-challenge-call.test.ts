import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import type { AriClient } from "./ari-client.js";
import { placeVoiceChallengeCall } from "./voice-challenge-call.js";

/** Minimal fake standing in for AriClient's event/originate/hangup/play surface. */
class FakeAriClient extends EventEmitter {
  originated: { channelId: string } | undefined;
  played: { channelId: string; media: string; playbackId: string } | undefined;
  hangups: string[] = [];

  async originate(_endpoint: string, channelId: string, _timeoutSeconds: number) {
    this.originated = { channelId };
  }

  async play(channelId: string, media: string, playbackId: string) {
    this.played = { channelId, media, playbackId };
  }

  async hangup(channelId: string) {
    this.hangups.push(channelId);
  }
}

function channelIdFrom(client: FakeAriClient): string {
  const id = client.originated?.channelId;
  assert.ok(id, "expected originate to have been called");
  return id;
}

describe("placeVoiceChallengeCall", () => {
  it("plays the recording once and resolves at awaiting_response once playback finishes", async () => {
    const client = new FakeAriClient();
    const progress: string[] = [];

    const resultPromise = placeVoiceChallengeCall(
      client as unknown as AriClient,
      "trunk-voice-challenge",
      "+15005550006",
      "sound:custom/potp/potp-challenge-rec_1",
      30,
      (state) => progress.push(state),
    );

    await new Promise((resolve) => setImmediate(resolve));
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "StasisStart", channel: { id: channelId } });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.played?.media, "sound:custom/potp/potp-challenge-rec_1");
    client.emit("event", { type: "PlaybackFinished", playback: { id: client.played?.playbackId } });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "awaiting_response", reasonCode: "recording_played" });
    assert.deepEqual(progress, ["ringing", "answered", "playing"]);
    assert.deepEqual(client.hangups, [channelId]);
  });

  it("fails without ever playing anything when the call is never answered", async () => {
    const client = new FakeAriClient();
    const resultPromise = placeVoiceChallengeCall(
      client as unknown as AriClient,
      "trunk-voice-challenge",
      "+15005550006",
      "sound:custom/potp/potp-challenge-rec_1",
      30,
      () => undefined,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "ChannelDestroyed", channel: { id: channelId }, cause: 17 });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "failed", reasonCode: "busy" });
    assert.equal(client.played, undefined);
  });
});
