import type { IncomingMessage, ServerResponse } from "node:http";

import {
  BehaviorReportSchema,
  BotBlockerOfflineResponseSchema,
  BotBlockerUnavailableResponseSchema,
  InitialBrowserProofEvidenceSchema,
  OtpLaunchMetadataSchema,
} from "@powerotp/contracts";

import {
  allowSnapshot,
  offlineSnapshot,
  otpSnapshot,
  retainsActiveOtp,
  verifiedSnapshot,
} from "./advisory.js";
import { appendPrivateCookie, encodeClearance, verifyClearanceCookie } from "./cookies.js";
import { HttpInputError, readEmptyBody, readJsonBody, sendJson } from "./http.js";
import {
  beginDecision,
  bootstrapProtocolVersion,
  createBehaviorReportRequest,
  normalizeChallenge,
  safeDecisionResult,
  scopedVisitorAuthorization,
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
  siteCredential: string;
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
    if (path === "/_powerotp/initial-evidence" && request.method === "POST") {
      const parsed = InitialBrowserProofEvidenceSchema.safeParse(
        await readJsonBody(request, options.limits.maxBodyBytes),
      );
      if (!parsed.success) throw new HttpInputError(400);
      options.session.initialBrowser = parsed.data;
      const clearance = parsed.data.proofs.clearance;
      if (clearance && !retainsActiveOtp(options.session)) {
        const verified = verifyClearanceCookie({
          value: encodeClearance(clearance),
          verificationKeys: options.verificationKeys,
          audience: options.audience,
          siteId: options.siteId,
          gateSessionId: options.session.id,
          now: options.now(),
        });
        if (verified.valid) {
          options.session.clearanceVerified = true;
          options.session.recommendation = allowSnapshot(options.session.lastApplied);
        }
      }
      await options.store.set(options.session);
      sendJson(response, 200, { status: "accepted" });
      return true;
    }
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
      sendJson(
        response,
        result.status === "decision" || result.status === "offline" ? 200 : 503,
        safeDecisionResult(result),
      );
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
        options.session.latestDecisionOutcome = applicable.outcome;
        options.session.latestDecision = undefined;
        options.session.acceptedNonces = [
          ...options.session.acceptedNonces.slice(-127),
          applicable.nonce,
        ];
        options.session.clearanceVerified = false;
        options.session.recommendation =
          applicable.outcome === "otp"
            ? otpSnapshot(applicable.sequence)
            : allowSnapshot(applicable.sequence);
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
    if (path === "/_powerotp/challenge/open" && request.method === "POST") {
      await readEmptyBody(request, options.limits.maxBodyBytes);
      const challenge = options.session.activeChallenge;
      const authorization = scopedVisitorAuthorization(options.session);
      if (
        !challenge ||
        !authorization ||
        options.session.latestDecisionOutcome !== "otp" ||
        !options.session.lastApplied
      ) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      const launched = await Promise.resolve()
        .then(() => options.services.launchChallenge(authorization, options.session))
        .catch(() => UNAVAILABLE);
      const launchUnavailable = BotBlockerUnavailableResponseSchema.safeParse(launched);
      if (launchUnavailable.success) {
        sendJson(response, 503, launchUnavailable.data);
        return true;
      }
      const launch = OtpLaunchMetadataSchema.safeParse(launched);
      if (!launch.success) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      if (launch.data.challengeId !== challenge.challengeId) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      options.session.activeChallenge = normalizeChallenge(launch.data);
      options.session.challengeOpened = true;
      options.session.recommendation = otpSnapshot(options.session.lastApplied, true);
      await options.store.set(options.session);
      sendJson(response, 200, launch.data);
      return true;
    }
    if (path === "/_powerotp/report" && request.method === "POST") {
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
      const authorization = scopedVisitorAuthorization(options.session);
      if (!authorization) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      const result = await Promise.resolve()
        .then(() =>
          options.services.submitReport(
            createBehaviorReportRequest({
              siteId: options.siteId,
              audience: options.audience,
              report: parsed.data,
            }),
            authorization,
            options.session,
          )
        )
        .then(laterReportResult)
        .catch(() => UNAVAILABLE);
      const offline = BotBlockerOfflineResponseSchema.safeParse(result);
      if (offline.success && !retainsActiveOtp(options.session)) {
        options.session.visitorToken = undefined;
        options.session.offlineUntil = options.now() + offline.data.retryAfterMs;
        options.session.recommendation = offlineSnapshot(
          options.session.lastApplied,
        );
        await options.store.set(options.session);
      }
      if (result.status === "decision") {
        options.session.latestDecision = result.candidate;
        if (result.challenge) {
          options.session.activeChallenge = normalizeChallenge(result.challenge);
          options.session.challengeVerified = false;
          options.session.challengeOpened = false;
        }
        await options.store.set(options.session);
      }
      await issueClearance(result, response, options);
      sendJson(
        response,
        result.status === "decision" || result.status === "offline" ? 200 : 503,
        safeDecisionResult(result),
      );
      return true;
    }
    if (path === "/_powerotp/challenge/status" && request.method === "GET") {
      const challenge = options.session.activeChallenge;
      const authorization = scopedVisitorAuthorization(options.session);
      if (!challenge || !authorization || options.session.challengeOpened !== true) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      const result = await Promise.resolve()
        .then(() => options.services.pollChallenge(challenge, authorization, options.session))
        .catch(() => UNAVAILABLE);
      if (result.status === "unavailable") {
        const unavailable = BotBlockerUnavailableResponseSchema.safeParse(result);
        sendJson(response, 503, unavailable.success ? unavailable.data : UNAVAILABLE);
        return true;
      }
      if (
        (result.status !== "pending" && result.status !== "verified") ||
        result.siteId !== options.siteId ||
        result.gateSessionId !== options.session.id ||
        result.challengeId !== challenge.challengeId
      ) {
        sendJson(response, 503, UNAVAILABLE);
        return true;
      }
      if (result.status === "verified") {
        options.session.challengeVerified = true;
        await options.store.set(options.session);
      }
      sendJson(response, 200, {
        status: result.status,
        siteId: result.siteId,
        gateSessionId: result.gateSessionId,
        challengeId: result.challengeId,
      });
      return true;
    }
    if (path === "/_powerotp/challenge/ack" && request.method === "POST") {
      const body = await readJsonBody(request, options.limits.maxBodyBytes);
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        body.challengeId !== options.session.activeChallenge?.challengeId ||
        options.session.challengeOpened !== true ||
        options.session.challengeVerified !== true
      ) {
        throw new HttpInputError(400);
      }
      options.session.activeChallenge = undefined;
      options.session.challengeVerified = false;
      options.session.challengeOpened = false;
      options.session.latestDecisionOutcome = undefined;
      options.session.clearanceVerified = false;
      options.session.recommendation = verifiedSnapshot(options.session.lastApplied);
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
  const restoredSecurityState =
    session.lastApplied &&
    session.activeChallenge &&
    session.recommendation?.lifecycle === "otp_required"
      ? {
          state: "otp_required" as const,
          decision: "otp" as const,
          lastApplied: session.lastApplied,
          acceptedNonces: session.acceptedNonces,
          activeChallengeId: session.activeChallenge.challengeId,
        }
      : session.recommendation?.lifecycle === "observing"
        ? {
            state: "observing" as const,
            decision: "allow" as const,
            ...(session.lastApplied ? { lastApplied: session.lastApplied } : {}),
            acceptedNonces: session.acceptedNonces,
          }
      : session.lastApplied
        ? {
            state: "checking" as const,
            lastApplied: session.lastApplied,
            acceptedNonces: session.acceptedNonces,
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
  if (
    options.session.visitorToken ||
    !options.session.requestContext ||
    !options.session.initialBrowser
  ) {
    return UNAVAILABLE;
  }
  return beginDecision({
    siteId: options.siteId,
    audience: options.audience,
    context: options.session.requestContext,
    initialBrowser: options.session.initialBrowser,
    siteCredential: options.siteCredential,
    decisionTimeoutMs: options.decisionTimeoutMs,
    session: options.session,
    services: options.services,
    save: () => Promise.resolve(options.store.set(options.session)),
    now: options.now,
  });
}

function laterReportResult(
  result: Awaited<ReturnType<GateNodeServices["submitReport"]>>,
): DecisionServiceResult {
  if (result.status === "ready") return UNAVAILABLE;
  if (result.status !== "decision") return result;
  return {
    status: "decision",
    candidate: result.candidate,
    ...(result.clearance !== undefined ? { clearance: result.clearance } : {}),
    ...(result.challenge ? { challenge: result.challenge } : {}),
  };
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
