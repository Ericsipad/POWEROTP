import type { IncomingMessage, ServerResponse } from "node:http";

import {
  BehaviorReportSchema,
  BotBlockerUnavailableResponseSchema,
} from "@powerotp/contracts";

import { appendPrivateCookie, encodeClearance, verifyClearanceCookie } from "./cookies.js";
import { HttpInputError, readJsonBody, sendJson } from "./http.js";
import {
  beginDecision,
  bootstrapProtocolVersion,
  normalizeChallenge,
  safeDecisionResult,
  UNAVAILABLE,
  verifyDecisionForSession,
} from "./runtime.js";
import type {
  BrowserBootstrap,
  DecisionServiceResult,
  GateNodeLimits,
  GateNodeServices,
  GateSession,
  GateSessionStore,
} from "./types.js";

export interface BridgeOptions {
  siteId: string;
  audience: string;
  decisionTimeoutMs: number;
  clearanceCookieName: string;
  cookieSecure: boolean;
  limits: Required<GateNodeLimits>;
  services: GateNodeServices;
  session: GateSession;
  store: GateSessionStore;
  verificationKeys: Parameters<typeof verifyClearanceCookie>[0]["verificationKeys"];
  now(): number;
}

export async function handleBridge(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: BridgeOptions,
): Promise<boolean> {
  if (!path.startsWith("/_powerotp/")) return false;
  try {
    if (path === "/_powerotp/session" && request.method === "GET") {
      sendJson(response, 200, bootstrap(options));
      return true;
    }
    if (path === "/_powerotp/decision" && request.method === "POST") {
      const body = await readJsonBody(request, options.limits.maxBodyBytes);
      if (!isRecord(body) || Object.keys(body).length !== 0) {
        throw new HttpInputError(400);
      }
      const result = await decision(options);
      await issueClearance(result, response, options);
      if (result.status === "decision" && result.clearance !== undefined) {
        options.session.latestClearance = undefined;
        await options.store.set(options.session);
      }
      sendJson(response, result.status === "decision" ? 200 : 503, safeDecisionResult(result));
      return true;
    }
    if (path === "/_powerotp/decision/verify" && request.method === "POST") {
      const body = await readJsonBody(request, options.limits.maxBodyBytes);
      const candidate = isRecord(body) ? body.candidate : undefined;
      const decision = await verifyDecisionForSession({
        candidate,
        session: options.session,
        services: options.services,
        siteId: options.siteId,
        audience: options.audience,
        now: options.now(),
      });
      const applicable =
        decision &&
        !(
          (decision.outcome === "otp" && !options.session.activeChallenge) ||
          (decision.outcome === "allow" && options.session.activeChallenge)
        )
          ? decision
          : undefined;
      if (applicable) {
        options.session.lastApplied = applicable.sequence;
        options.session.latestDecision = undefined;
        options.session.acceptedNonces = [
          ...options.session.acceptedNonces.slice(-127),
          applicable.nonce,
        ];
        await options.store.set(options.session);
      }
      sendJson(
        response,
        applicable ? 200 : 400,
        applicable
          ? { verified: true, decision: applicable }
          : { verified: false },
      );
      return true;
    }
    if (path === "/_powerotp/browser-assessment" && request.method === "POST") {
      const parsed = BehaviorReportSchema.safeParse(
        await readJsonBody(request, options.limits.maxBodyBytes),
      );
      if (
        !parsed.success ||
        parsed.data.sequence.gateSessionId !== options.session.id ||
        parsed.data.sequence.sequence !== options.session.nextSequence
      ) {
        throw new HttpInputError(400);
      }
      options.session.nextSequence += 1;
      await options.store.set(options.session);
      const result = await options.services
        .assessBrowser(parsed.data, options.session)
        .catch(() => UNAVAILABLE);
      if (result.status === "decision") {
        options.session.latestDecision = result.candidate;
        if (result.challenge) {
          options.session.activeChallenge = normalizeChallenge(result.challenge);
          options.session.challengeVerified = false;
        }
        await options.store.set(options.session);
      }
      await issueClearance(result, response, options);
      sendJson(response, result.status === "decision" ? 200 : 503, safeDecisionResult(result));
      return true;
    }
    if (path === "/_powerotp/challenge/status" && request.method === "GET") {
      const challenge = options.session.activeChallenge;
      if (!challenge) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      const result = await options.services
        .pollChallenge(challenge, options.session)
        .catch(() => UNAVAILABLE);
      if (
        result.status !== "unavailable" &&
        (result.siteId !== options.siteId ||
          result.gateSessionId !== options.session.id ||
          result.challengeId !== challenge.challengeId)
      ) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      if (result.status === "verified") {
        options.session.challengeVerified = true;
        await options.store.set(options.session);
      }
      sendJson(response, result.status === "unavailable" ? 503 : 200, result);
      return true;
    }
    if (path === "/_powerotp/challenge/ack" && request.method === "POST") {
      const body = await readJsonBody(request, options.limits.maxBodyBytes);
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        body.challengeId !== options.session.activeChallenge?.challengeId ||
        options.session.challengeVerified !== true
      ) {
        throw new HttpInputError(400);
      }
      options.session.activeChallenge = undefined;
      options.session.challengeVerified = false;
      await options.store.set(options.session);
      sendJson(response, 200, { status: "acknowledged" });
      return true;
    }
    sendJson(response, 404, {
      status: "error",
      code: "invalid_request",
      message: "Route not found",
    });
    return true;
  } catch (error) {
    const status = error instanceof HttpInputError ? error.status : 400;
    sendJson(response, status, {
      status: "error",
      code: "invalid_request",
      message: "Invalid request",
    });
    return true;
  }
}

function bootstrap(options: BridgeOptions): BrowserBootstrap {
  const { session } = options;
  const restoredSecurityState = session.lastApplied
    ? {
        state: session.activeChallenge ? ("otp_required" as const) : ("checking" as const),
        lastApplied: session.lastApplied,
        acceptedNonces: session.acceptedNonces,
        ...(session.activeChallenge
          ? { activeChallengeId: session.activeChallenge.challengeId }
          : {}),
      }
    : undefined;
  return {
    protocolVersion: bootstrapProtocolVersion(),
    siteId: options.siteId,
    audience: options.audience,
    gateSessionId: session.id,
    startingSequence: session.nextSequence,
    decisionTimeoutMs: options.decisionTimeoutMs,
    ...(restoredSecurityState ? { restoredSecurityState } : {}),
    ...(session.activeChallenge ? { challenge: session.activeChallenge } : {}),
  };
}

async function decision(options: BridgeOptions): Promise<DecisionServiceResult> {
  if (options.session.latestDecision !== undefined) {
    return {
      status: "decision",
      candidate: options.session.latestDecision,
      ...(options.session.latestClearance !== undefined
        ? { clearance: options.session.latestClearance }
        : {}),
      ...(options.session.activeChallenge
        ? { challenge: options.session.activeChallenge }
        : {}),
    };
  }
  if (!options.session.requestContext) return UNAVAILABLE;
  return beginDecision({
    context: options.session.requestContext,
    session: options.session,
    services: options.services,
    save: () => Promise.resolve(options.store.set(options.session)),
  });
}

export async function issueClearance(
  result: DecisionServiceResult,
  response: ServerResponse,
  options: BridgeOptions,
): Promise<void> {
  if (result.status !== "decision" || result.clearance === undefined) return;
  const decision = await verifyDecisionForSession({
    candidate: result.candidate,
    session: options.session,
    services: options.services,
    siteId: options.siteId,
    audience: options.audience,
    now: options.now(),
  });
  if (
    decision?.outcome !== "allow" ||
    options.session.activeChallenge !== undefined
  ) {
    return;
  }
  let encoded: string;
  try {
    encoded = encodeClearance(result.clearance);
  } catch {
    return;
  }
  const verified = verifyClearanceCookie({
    value: encoded,
    verificationKeys: options.verificationKeys,
    audience: options.audience,
    siteId: options.siteId,
    gateSessionId: options.session.id,
    now: options.now(),
  });
  if (!verified.valid || !verified.clearance) return;
  appendPrivateCookie(response, options.clearanceCookieName, encoded, {
    secure: options.cookieSecure,
    expiresAt: verified.clearance.expiresAt,
    now: options.now(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
