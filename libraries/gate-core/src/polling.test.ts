import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAuthoritativePoller,
  type AuthoritativeVerificationStatus,
} from "./polling.js";

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}

describe("authoritative verification poller", () => {
  it("uses only polling output as verification authority", async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const statuses: AuthoritativeVerificationStatus[] = [];
    const results: AuthoritativeVerificationStatus[] = ["pending", "unavailable", "verified"];
    const poller = createAuthoritativePoller({
      intervalMs: 500,
      check: async () => results.shift() ?? "pending",
      onStatus: (status) => statuses.push(status),
      setTimer(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer() {},
    });

    poller.start();
    const runFirst = scheduled.shift();
    assert.equal(runFirst?.delay, 0);
    runFirst?.callback();
    await flushPromises();
    assert.deepEqual(statuses, ["pending"]);
    assert.equal(scheduled[0]?.delay, 500);

    const runSecond = scheduled.shift();
    runSecond?.callback();
    await flushPromises();
    assert.deepEqual(statuses, ["pending", "unavailable"]);
    assert.equal(poller.isRunning(), true);

    poller.triggerNow();
    const runThird = scheduled.at(-1);
    assert.equal(runThird?.delay, 0);
    runThird?.callback();
    await flushPromises();
    assert.deepEqual(statuses, ["pending", "unavailable", "verified"]);
    assert.equal(poller.isRunning(), false);
  });

  it("treats polling errors as unavailable without unlocking", async () => {
    let callback: (() => void) | undefined;
    const statuses: AuthoritativeVerificationStatus[] = [];
    const poller = createAuthoritativePoller({
      intervalMs: 100,
      check: async () => {
        throw new Error("network");
      },
      onStatus: (status) => statuses.push(status),
      setTimer(next) {
        callback = next;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer() {},
    });
    poller.start();
    callback?.();
    await flushPromises();
    assert.deepEqual(statuses, ["unavailable"]);
    assert.equal(poller.isRunning(), true);
    poller.stop();
  });

  it("ignores an in-flight result from an earlier stopped generation", async () => {
    const scheduled: Array<() => void> = [];
    const oldCheck = deferred<AuthoritativeVerificationStatus>();
    const newCheck = deferred<AuthoritativeVerificationStatus>();
    const checks = [oldCheck.promise, newCheck.promise];
    const statuses: AuthoritativeVerificationStatus[] = [];
    const poller = createAuthoritativePoller({
      intervalMs: 100,
      check: () => checks.shift() ?? Promise.resolve("pending"),
      onStatus: (status) => statuses.push(status),
      setTimer(callback) {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer() {},
    });

    poller.start();
    scheduled.shift()?.();
    poller.stop();
    poller.start();
    scheduled.shift()?.();

    oldCheck.resolve("verified");
    await flushPromises();
    assert.deepEqual(statuses, []);
    assert.equal(poller.isRunning(), true);

    newCheck.resolve("pending");
    await flushPromises();
    assert.deepEqual(statuses, ["pending"]);
    assert.equal(poller.isRunning(), true);
    poller.stop();
  });

  it("rejects invalid polling intervals", () => {
    assert.throws(
      () =>
        createAuthoritativePoller({
          intervalMs: 0,
          check: async () => "pending",
          onStatus() {},
        }),
      /positive integer/,
    );
  });
});
