import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOTBLOCKER_PROTOCOL_VERSION } from "@powerotp/contracts";
import { createGateController, type GateEffect } from "./controller.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "site_phase9_123456";
const SESSION_ID = "gate_session_phase9";
const AUDIENCE = "https://customer.example";
const CHALLENGE_ID = "challenge_phase9_123";

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
    assert.deepEqual(controller.getSnapshot(), { state: "checking", decisionPending: true });

    timeoutCallback?.();
    assert.deepEqual(controller.getSnapshot(), {
      state: "optimistic_allow",
      decisionPending: true,
    });

    request.resolve(decision(1, "otp"));
    await flushPromises();
    assert.equal(controller.getSnapshot().state, "otp_required");
    assert.equal(controller.getSnapshot().decisionPending, false);
    assert.deepEqual(
      effects.map((effect) => effect.type),
      [
        "start_observation",
        "pause_observation",
        "freeze_page",
        "start_authoritative_polling",
      ],
    );
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
    assert.equal(controller.getSnapshot().state, "observing");

    assert.equal(await controller.applyDecisionRevision(decision(1, "otp")), false);
    assert.equal(controller.getSnapshot().state, "observing");
    assert.equal(effects.at(-1)?.type, "decision_rejected");

    assert.equal(await controller.applyDecisionRevision(decision(2, "otp")), true);
    assert.equal(controller.getSnapshot().state, "otp_required");
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
    assert.equal(unavailable.getSnapshot().state, "unavailable");
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
    assert.equal(locked.getSnapshot().state, "otp_required");
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
    assert.equal(locked.getSnapshot().state, "otp_required");
  });

  it("restores an active OTP across reload without starting a fail-open request", () => {
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
      onEffect: (effect) => effects.push(effect),
    });

    controller.start();
    assert.equal(requestCount, 0);
    assert.equal(controller.getSnapshot().state, "otp_required");
    assert.deepEqual(
      effects.map((effect) => effect.type),
      ["pause_observation", "freeze_page", "start_authoritative_polling"],
    );
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
      now: () => NOW,
      onEffect: (effect) => effects.push(effect),
    });
    controller.start();
    await flushPromises();

    assert.equal(controller.bindActiveChallenge(CHALLENGE_ID), true);
    assert.equal(
      controller.applyAuthoritativeStatus({
        status: "pending",
        siteId: SITE_ID,
        gateSessionId: SESSION_ID,
        challengeId: CHALLENGE_ID,
      }),
      false,
    );
    assert.equal(controller.getSnapshot().state, "otp_required");
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
    assert.equal(controller.getSnapshot().state, "verified");
    assert.deepEqual(
      effects.slice(-2).map((effect) => effect.type),
      ["stop_authoritative_polling", "unfreeze_page"],
    );

    assert.equal(controller.resumeObservation(), true);
    assert.equal(controller.getSnapshot().state, "observing");
    assert.deepEqual(effects.at(-1), { type: "start_observation", fresh: true });
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
    assert.equal(controller.getSnapshot().state, "checking");
    controller.dispose();
  });
});
