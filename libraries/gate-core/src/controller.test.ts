import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOTBLOCKER_PROTOCOL_VERSION } from "@powerotp/contracts/browser";
import { createGateController, type GateEffect } from "./controller.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "site_phase9_123456";
const SESSION_ID = "gate_session_phase9";
const AUDIENCE = "https://customer.example";
const CHALLENGE_ID = "challenge_phase9_123";
const launchMetadata = {
  challengeId: CHALLENGE_ID,
  challengeUrl: `https://verify.powerotp.com/challenge/${CHALLENGE_ID}`,
  challengeOrigin: "https://verify.powerotp.com",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function decision(sequence: number, outcome: "allow" | "otp", nonce = `nonce_phase9_${sequence}`) {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId: SITE_ID,
    sequence: { gateSessionId: SESSION_ID, sequence, issuedAt: NOW + sequence },
    outcome,
    audience: AUDIENCE,
    nonce: nonce.padEnd(16, "0"),
    expiresAt: NOW + 60_000,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("gate controller", () => {
  it("keeps the request pending at timeout and applies a late OTP", async () => {
    const request = deferred<unknown>();
    const effects: GateEffect[] = [];
    let timeoutCallback: (() => void) | undefined;
    let timeoutDelay = 0;
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: () => request.promise,
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
      setTimer(callback, delay) {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      onEffect: (effect) => effects.push(effect),
    });

    controller.start();
    assert.equal(timeoutDelay, 200);
    assert.deepEqual(controller.getSnapshot(), {
      lifecycle: "checking",
      recommendation: "restricted",
      decisionPending: true,
      otpOpen: false,
    });

    timeoutCallback?.();
    assert.deepEqual(controller.getSnapshot(), {
      lifecycle: "fail_open",
      recommendation: "full_access",
      decisionPending: true,
      otpOpen: false,
    });

    request.resolve(decision(1, "otp"));
    await flushPromises();
    const otpSnapshot = controller.getSnapshot();
    assert.equal(otpSnapshot.lifecycle, "otp_required");
    if (otpSnapshot.lifecycle !== "otp_required") assert.fail("expected OTP snapshot");
    assert.equal(otpSnapshot.decisionPending, false);
    assert.deepEqual(
      effects.map((effect) => effect.type),
      ["start_observation"],
    );
    assert.equal(otpSnapshot.decision, "otp");
    assert.equal(otpSnapshot.otpOpen, false);
  });

  it("escalates an observed allow only for a newer valid OTP revision", async () => {
    const effects: GateEffect[] = [];
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 50,
      requestDecision: async () => decision(1, "allow"),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
      onEffect: (effect) => effects.push(effect),
    });

    controller.start();
    await flushPromises();
    assert.equal(controller.getSnapshot().lifecycle, "observing");

    assert.equal(await controller.applyDecisionRevision(decision(1, "otp")), false);
    assert.equal(controller.getSnapshot().lifecycle, "observing");
    assert.equal(effects.at(-1)?.type, "decision_rejected");

    assert.equal(await controller.applyDecisionRevision(decision(2, "otp")), true);
    assert.equal(controller.getSnapshot().lifecycle, "otp_required");
  });

  it("fails open on request failure without overriding an active challenge", async () => {
    const failedRequest = deferred<unknown>();
    const unavailableEffects: GateEffect[] = [];
    const unavailable = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: () => failedRequest.promise,
      verifyDecision: async () => ({ verified: false }),
      now: () => NOW,
      onEffect: (effect) => unavailableEffects.push(effect),
    });
    unavailable.start();
    failedRequest.reject(new Error("network"));
    await flushPromises();
    assert.equal(unavailable.getSnapshot().lifecycle, "unavailable");
    assert.deepEqual(unavailableEffects.at(-1), { type: "start_observation", fresh: false });

    const locked = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: async () => decision(1, "otp"),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
    });
    locked.start();
    await flushPromises();
    assert.equal(locked.getSnapshot().lifecycle, "otp_required");
    assert.equal(
      locked.applyAuthoritativeStatus({
        status: "unavailable",
        siteId: SITE_ID,
        gateSessionId: SESSION_ID,
        challengeId: CHALLENGE_ID,
      }),
      false,
    );
    assert.equal(await locked.applyDecisionRevision(decision(2, "allow")), false);
    assert.equal(locked.getSnapshot().lifecycle, "otp_required");
  });

  it("restores OTP advisory state without reopening until explicit invocation", async () => {
    const effects: GateEffect[] = [];
    let requestCount = 0;
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      restoredSecurityState: {
        state: "otp_required",
        lastApplied: { gateSessionId: SESSION_ID, sequence: 4, issuedAt: NOW },
        acceptedNonces: ["restored_nonce_1234"],
        activeChallengeId: CHALLENGE_ID,
      },
      requestDecision: async () => {
        requestCount += 1;
        return decision(5, "allow");
      },
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      launchOtp: async () => launchMetadata,
      onEffect: (effect) => effects.push(effect),
    });

    controller.start();
    assert.equal(requestCount, 0);
    assert.equal(controller.getSnapshot().lifecycle, "otp_required");
    assert.equal(controller.getSnapshot().otpOpen, false);
    assert.equal(effects.length, 0);

    assert.equal(await controller.openOtp(), true);
    assert.deepEqual(effects.map((effect) => effect.type), [
      "pause_observation",
      "freeze_page",
      "start_authoritative_polling",
    ]);
  });

  it("unfreezes only after authoritative verification and resumes fresh observation", async () => {
    const effects: GateEffect[] = [];
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: async () => decision(1, "otp"),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      launchOtp: async () => launchMetadata,
      now: () => NOW,
      onEffect: (effect) => effects.push(effect),
    });
    controller.start();
    await flushPromises();

    assert.equal(effects.length, 0);
    assert.equal(await controller.openOtp(), true);
    assert.deepEqual(effects.map((effect) => effect.type), [
      "pause_observation",
      "freeze_page",
      "start_authoritative_polling",
    ]);
    assert.equal(
      controller.applyAuthoritativeStatus({
        status: "pending",
        siteId: SITE_ID,
        gateSessionId: SESSION_ID,
        challengeId: CHALLENGE_ID,
      }),
      false,
    );
    assert.equal(controller.getSnapshot().lifecycle, "otp_required");
    assert.equal(
      controller.applyAuthoritativeStatus({
        status: "verified",
        siteId: "wrong_site_123456",
        gateSessionId: SESSION_ID,
        challengeId: CHALLENGE_ID,
      }),
      false,
    );
    assert.equal(
      controller.applyAuthoritativeStatus({
        status: "verified",
        siteId: SITE_ID,
        gateSessionId: SESSION_ID,
        challengeId: CHALLENGE_ID,
      }),
      true,
    );
    assert.equal(controller.getSnapshot().lifecycle, "verified");
    assert.deepEqual(
      effects.slice(-2).map((effect) => effect.type),
      ["stop_authoritative_polling", "unfreeze_page"],
    );

    assert.equal(controller.resumeObservation(), true);
    assert.equal(controller.getSnapshot().lifecycle, "verified");
    assert.deepEqual(effects.at(-1), { type: "start_observation", fresh: true });
    assert.equal(controller.resumeObservation(), false);
  });

  it("publishes verified local and RapidAuth allow recommendations", async () => {
    const local = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      restoredSecurityState: {
        state: "observing",
        decision: "allow",
      },
      requestDecision: async () => {
        throw new Error("local allow must not request RapidAuth");
      },
      verifyDecision: async () => ({ verified: false }),
    });
    local.start();
    assert.deepEqual(local.getSnapshot(), {
      lifecycle: "observing",
      recommendation: "full_access",
      decision: "allow",
      decisionPending: false,
      otpOpen: false,
    });

    const rapidAuth = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: async () => decision(1, "allow"),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
    });
    rapidAuth.start();
    await flushPromises();
    const rapidAuthSnapshot = rapidAuth.getSnapshot();
    assert.equal(rapidAuthSnapshot.lifecycle, "observing");
    if (rapidAuthSnapshot.lifecycle !== "observing") assert.fail("expected allow snapshot");
    assert.equal(rapidAuthSnapshot.decision, "allow");
  });

  it("notifies subscribers in order with stable snapshots", async () => {
    const request = deferred<unknown>();
    const observed: Array<{ lifecycle: string; pending: boolean }> = [];
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: () => request.promise,
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      now: () => NOW,
    });
    const initial = controller.getSnapshot();
    assert.equal(controller.getSnapshot(), initial);
    const unsubscribe = controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      observed.push({
        lifecycle: snapshot.lifecycle,
        pending: snapshot.decisionPending,
      });
      assert.equal(controller.getSnapshot(), snapshot);
    });

    controller.start();
    request.resolve(decision(1, "allow"));
    await flushPromises();
    unsubscribe();
    await controller.applyDecisionRevision(decision(2, "allow"));

    assert.deepEqual(observed, [
      { lifecycle: "checking", pending: true },
      { lifecycle: "observing", pending: false },
    ]);
  });

  it("rejects openOtp before OTP and exposes no caller options", async () => {
    let launchCount = 0;
    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 200,
      requestDecision: async () => decision(1, "allow"),
      verifyDecision: async (candidate) => ({ verified: true, decision: candidate }),
      launchOtp: async () => {
        launchCount += 1;
        return launchMetadata;
      },
      now: () => NOW,
    });
    assert.equal(controller.openOtp.length, 0);
    assert.equal(await controller.openOtp(), false);
    controller.start();
    await flushPromises();
    assert.equal(await controller.openOtp(), false);
    assert.equal(launchCount, 0);
    // @ts-expect-error -- callers cannot select an OTP method or content.
    if (false) await controller.openOtp({ method: "sms" });
  });

  it("rejects unsigned decisions and invalid timeout configuration", async () => {
    assert.throws(
      () =>
        createGateController({
          siteId: SITE_ID,
          gateSessionId: SESSION_ID,
          audience: AUDIENCE,
          decisionTimeoutMs: 49,
          requestDecision: async () => ({}),
          verifyDecision: async () => ({ verified: false }),
        }),
      /at least 50ms/,
    );
    assert.throws(
      () =>
        createGateController({
          siteId: SITE_ID,
          gateSessionId: SESSION_ID,
          audience: AUDIENCE,
          decisionTimeoutMs: 2_001,
          requestDecision: async () => ({}),
          verifyDecision: async () => ({ verified: false }),
        }),
      /at most 2000ms/,
    );

    const controller = createGateController({
      siteId: SITE_ID,
      gateSessionId: SESSION_ID,
      audience: AUDIENCE,
      decisionTimeoutMs: 2_000,
      requestDecision: async () => decision(1, "allow"),
      verifyDecision: async () => ({ verified: false, reason: "unsigned" }),
      now: () => NOW,
    });
    controller.start();
    await flushPromises();
    assert.equal(controller.getSnapshot().lifecycle, "checking");
    controller.dispose();
  });
});
