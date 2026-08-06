import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import type { AriClient } from "./ari-client.js";
import { reasonCodeForHangupCause } from "./hangup-causes.js";
import { placeReachabilityCall } from "./reachability-call.js";

describe("reasonCodeForHangupCause", () => {
  it("maps known Q.850 causes to the stable reason-code vocabulary", () => {
    assert.equal(reasonCodeForHangupCause(17), "busy");
    assert.equal(reasonCodeForHangupCause(18), "no_answer");
    assert.equal(reasonCodeForHangupCause(19), "no_answer");
    assert.equal(reasonCodeForHangupCause(21), "call_rejected");
    assert.equal(reasonCodeForHangupCause(1), "invalid_number");
  });

  it("falls back to a generic reason for unmapped or missing causes", () => {
    assert.equal(reasonCodeForHangupCause(999), "call_failed");
    assert.equal(reasonCodeForHangupCause(undefined), "call_failed");
  });
});

/** Minimal fake standing in for AriClient's event/originate/hangup surface. */
class FakeAriClient extends EventEmitter {
  originated: { endpoint: string; channelId: string; timeoutSeconds: number } | undefined;
  hangups: string[] = [];
  originateError: Error | undefined;

  async originate(endpoint: string, channelId: string, timeoutSeconds: number) {
    this.originated = { endpoint, channelId, timeoutSeconds };
    if (this.originateError) throw this.originateError;
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

describe("placeReachabilityCall", () => {
  it("succeeds once the channel enters Stasis (answered) and hangs up", async () => {
    const client = new FakeAriClient();
    const progress: string[] = [];

    const resultPromise = placeReachabilityCall(
      client as unknown as AriClient,
      "trunk-call-reachability",
      "+15005550006",
      30,
      (state) => progress.push(state),
    );

    await new Promise((resolve) => setImmediate(resolve));
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "ChannelStateChange", channel: { id: channelId, state: "Ringing" } });
    client.emit("event", { type: "StasisStart", channel: { id: channelId } });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "succeeded", reasonCode: "answered" });
    assert.deepEqual(progress, ["ringing", "answered"]);
    assert.deepEqual(client.hangups, [channelId]);
  });

  it("reports busy when the channel is destroyed with cause 17 before answering", async () => {
    const client = new FakeAriClient();
    const resultPromise = placeReachabilityCall(
      client as unknown as AriClient,
      "trunk-call-reachability",
      "+15005550006",
      30,
      () => undefined,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const channelId = channelIdFrom(client);
    client.emit("event", { type: "ChannelDestroyed", channel: { id: channelId }, cause: 17 });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "failed", reasonCode: "busy" });
  });

  it("fails with originate_failed when ARI rejects the originate call", async () => {
    const client = new FakeAriClient();
    client.originateError = new Error("boom");

    const result = await placeReachabilityCall(
      client as unknown as AriClient,
      "trunk-call-reachability",
      "+15005550006",
      30,
      () => undefined,
    );

    assert.deepEqual(result, { state: "failed", reasonCode: "originate_failed" });
  });

  it("ignores events for unrelated channels", async () => {
    const client = new FakeAriClient();
    const resultPromise = placeReachabilityCall(
      client as unknown as AriClient,
      "trunk-call-reachability",
      "+15005550006",
      30,
      () => undefined,
    );

    await new Promise((resolve) => setImmediate(resolve));
    client.emit("event", { type: "StasisStart", channel: { id: "some-other-channel" } });
    client.emit("event", {
      type: "ChannelDestroyed",
      channel: { id: channelIdFrom(client) },
      cause: 21,
    });

    const result = await resultPromise;
    assert.deepEqual(result, { state: "failed", reasonCode: "call_rejected" });
  });
});
