import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "node:test";

import type { AgentConfig } from "./config.js";
import { pollAndRunOneJob } from "./job-poller.js";

/** Minimal fake standing in for AriClient's event/originate/hangup surface. */
class FakeAriClient extends EventEmitter {
  originated: { endpoint: string; channelId: string } | undefined;

  isOpen() {
    return true;
  }

  async originate(endpoint: string, channelId: string) {
    this.originated = { endpoint, channelId };
  }

  async hangup(_channelId: string) {
    // no-op
  }
}

const config: AgentConfig = {
  NODE_SECRET: "a".repeat(32),
  CONTROL_PLANE_URL: "https://control-plane.example",
  ARI_URL: "http://127.0.0.1:8088",
  ARI_USER: "u",
  ARI_PASS: "p",
  POLL_INTERVAL_MS: 60_000,
  JOB_POLL_INTERVAL_MS: 2_000,
  CALL_RING_TIMEOUT_SECONDS: 30,
  MEDIA_SOUND_PREFIX: "custom/potp",
  MEDIA_POLL_INTERVAL_MS: 60_000,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("pollAndRunOneJob", () => {
  it("never lets a later progress/result report reach the server before an earlier one lands", async () => {
    // Regression test for a race where report("ringing")/report("answered")
    // are dispatched without being awaited by call-control code (they must
    // stay responsive to ARI events), which could previously let a later
    // report's HTTP request complete before an earlier one's — the losing
    // one silently rejected as stale by the control plane's optimistic
    // concurrency check. This asserts the agent itself never has two
    // `/events` requests for the same job in flight at once, regardless of
    // how slowly any individual request resolves.
    let inFlight = 0;
    const eventBodies: unknown[] = [];

    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith("/v1/nodes/jobs/next?type=call_reachability")) {
        return new Response(
          JSON.stringify({
            interactionId: "int_0000000000000test",
            type: "call_reachability",
            targetNumber: "+15005550006",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (href.includes("/v1/nodes/jobs/int_0000000000000test/events")) {
        assert.equal(inFlight, 0, "a second report was sent before the previous one landed");
        inFlight += 1;
        eventBodies.push(JSON.parse(String(init?.body)));
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch to ${href}`);
    }) as typeof fetch;

    const ari = new FakeAriClient();
    const jobPromise = pollAndRunOneJob(config, ari as never, new Set(["call_reachability"]), () => undefined);

    await new Promise((resolve) => setImmediate(resolve));
    const channelId = ari.originated?.channelId;
    assert.ok(channelId, "expected originate to have been called");
    ari.emit("event", { type: "ChannelStateChange", channel: { id: channelId, state: "Ringing" } });
    ari.emit("event", { type: "StasisStart", channel: { id: channelId } });

    await jobPromise;

    assert.deepEqual(
      eventBodies.map((body) => (body as { state: string }).state),
      ["ringing", "answered", "succeeded"],
    );
  });
});
