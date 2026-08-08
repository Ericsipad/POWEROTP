import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import type { AriClient } from "./ari-client.js";
import { placeVoiceCodeCall } from "./voice-code-call.js";

/** Minimal fake standing in for AriClient's event/originate/hangup/play surface. */
class FakeAriClient extends EventEmitter {
  originated: { channelId: string } | undefined;
  plays: { channelId: string; media: string; playbackId: string }[] = [];
  hangups: string[] = [];
  originateError: Error | undefined;
  playError: Error | undefined;

  async originate(_endpoint: string, channelId: string, _timeoutSeconds: number) {
    this.originated = { channelId };
    if (this.originateError) throw this.originateError;
  }

  async play(channelId: string, media: string, playbackId: string) {
    this.plays.push({ channelId, media, playbackId });
    if (this.playError) throw this.playError;
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

/**
 * A single `await Promise.resolve()` only advances one microtask, which
 * isn't reliably enough hops to settle a chain like "async function
 * throws" -> its rejection settling -> a `.catch` handler running -> the
 * `await` on that handler's result continuing. `setImmediate` is a real
 * (unmocked, since only `setTimeout` is mocked in these tests) macrotask
 * boundary, so awaiting it drains every pending microtask first.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("placeVoiceCodeCall", () => {
  it("speaks the code twice as separate playbacks with a silent pause in between", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new FakeAriClient();
    const progress: string[] = [];

    const resultPromise = placeVoiceCodeCall(
      client as unknown as AriClient,
      "trunk-voice-code",
      "+15005550006",
      "12345",
      30,
      (state) => progress.push(state),
    );

    await flushMicrotasks();
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "StasisStart", channel: { id: channelId } });

    await flushMicrotasks();
    assert.equal(client.plays.length, 1, "expected the first repetition to start immediately");
    assert.equal(client.plays[0]!.media, "digits:12345");
    client.emit("event", { type: "PlaybackFinished", playback: { id: client.plays[0]!.playbackId } });

    // The second repetition must not start until the silent pause elapses.
    await flushMicrotasks();
    assert.equal(client.plays.length, 1, "expected no second repetition before the pause elapses");

    t.mock.timers.tick(2_000);
    await flushMicrotasks();
    assert.equal(client.plays.length, 2, "expected the second repetition after the pause");
    assert.equal(client.plays[1]!.media, "digits:12345");
    assert.notEqual(client.plays[1]!.playbackId, client.plays[0]!.playbackId);
    client.emit("event", { type: "PlaybackFinished", playback: { id: client.plays[1]!.playbackId } });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "awaiting_response", reasonCode: "code_played" });
    // "ringing" fires defensively even though no ChannelStateChange arrived
    // here — see originateAndWaitForAnswer's ring() guard.
    assert.deepEqual(progress, ["ringing", "answered", "playing"]);
    assert.deepEqual(client.hangups, [channelId]);
  });

  it("fails without ever playing anything when the call is never answered", async () => {
    const client = new FakeAriClient();
    const resultPromise = placeVoiceCodeCall(
      client as unknown as AriClient,
      "trunk-voice-code",
      "+15005550006",
      "12345",
      30,
      () => undefined,
    );

    await flushMicrotasks();
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "ChannelDestroyed", channel: { id: channelId }, cause: 17 });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "failed", reasonCode: "busy" });
    assert.deepEqual(client.plays, []);
  });

  it("still hangs up even if the playback call itself throws", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new FakeAriClient();
    client.playError = new Error("boom");

    const resultPromise = placeVoiceCodeCall(
      client as unknown as AriClient,
      "trunk-voice-code",
      "+15005550006",
      "12345",
      30,
      () => undefined,
    );

    await flushMicrotasks();
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "StasisStart", channel: { id: channelId } });

    // First repetition's play() rejects immediately; still waits out the
    // silent pause before attempting the second repetition.
    await flushMicrotasks();
    t.mock.timers.tick(2_000);
    await flushMicrotasks();

    const result = await resultPromise;
    assert.deepEqual(result, { state: "awaiting_response", reasonCode: "code_played" });
    assert.deepEqual(client.hangups, [channelId]);
  });
});
