import { createServer, type RequestListener, type Server } from "node:http";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BotBlockerWebhookIdSchema,
  DecisionTimeoutMsSchema,
  SiteCredentialSchema,
  SiteIdSchema,
} from "@powerotp/contracts";

import { handleBridge } from "./bridge.js";
import { readCookie, verifyClearanceCookie } from "./cookies.js";
import { createAgentDiscovery, sendAgentDiscovery } from "./discovery.js";
import {
  buildRequestContext,
  DEFAULT_LIMITS,
  isInfrastructureExcluded,
  isSameOriginBridgeRequest,
  requestPath,
  sendJson,
  validateTrustedProxy,
  withinHeaderLimits,
} from "./http.js";
import {
  beginDecision,
  createServices,
} from "./runtime.js";
import {
  allowSnapshot,
  advisoryState,
  checkingSnapshot,
  unavailableSnapshot,
} from "./advisory.js";
import { handleProjectCallback } from "./callbacks.js";
import { createMemoryGateSessionStore, resolveGateSession } from "./session.js";
import type {
  GateNodeOptions,
} from "./types.js";

export function createPowerOtpRequestListener(options: GateNodeOptions): RequestListener {
  const siteId = SiteIdSchema.parse(options.siteId);
  BotBlockerWebhookIdSchema.parse(options.webhookId);
  SiteCredentialSchema.parse(options.siteCredential);
  if (
    options.projectId !== undefined &&
    (options.projectId.length < 16 || options.projectId.length > 128)
  ) {
    throw new TypeError("Project ID must contain 16 through 128 characters");
  }
  if (
    options.callbackSigningSecret !== undefined &&
    options.callbackSigningSecret.length < 32
  ) {
    throw new TypeError("Callback signing secret must contain at least 32 characters");
  }
  if (!options.audience || options.audience.length > 2_048) {
    throw new TypeError("Audience must contain 1 through 2048 characters");
  }
  const decisionTimeoutMs = DecisionTimeoutMsSchema.parse(
    options.decisionTimeoutMs ?? BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  );
  validateTrustedProxy(options.trustedProxy);
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  validateLimits(limits);
  const services = createServices(options.services);
  const store = options.sessionStore ?? createMemoryGateSessionStore();
  const cookieName = options.cookieName ?? "powerotp_access";
  const sessionCookieName = options.sessionCookieName ?? "powerotp_gate";
  const cookieSecure = options.cookieSecure ?? true;
  const now = options.now ?? Date.now;
  const discovery = createAgentDiscovery(options.cleanDataPage);

  return async (request, response) => {
    let route: "bridge" | "application" = "application";
    try {
      if (!withinHeaderLimits(request, limits)) {
        options.onEvent?.({ type: "invalid_request", route });
        sendJson(response, 431, invalidRequest());
        return;
      }
      const path = requestPath(request, limits.maxPathBytes);
      if (!path) {
        options.onEvent?.({ type: "invalid_request", route });
        sendJson(response, 414, invalidRequest());
        return;
      }
      if (path === "/.well-known/powerotp-agent") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(response, 405, invalidRequest());
        } else {
          sendAgentDiscovery(response, discovery, request.method === "HEAD");
        }
        return;
      }
      if (
        await handleProjectCallback(request, response, path, {
          projectId: options.projectId,
          siteId,
          callbackSigningSecret: options.callbackSigningSecret,
          limits,
          services,
          store,
          now,
        })
      ) {
        return;
      }

      const isBridge = path === "/_powerotp" || path.startsWith("/_powerotp/");
      if (isBridge) {
        route = "bridge";
        if (!isSameOriginBridgeRequest(request, options.audience)) {
          options.onEvent?.({ type: "invalid_request", route });
          sendJson(response, 403, invalidRequest());
          return;
        }
        const session = await resolveGateSession({
          request,
          response,
          store,
          cookieName: sessionCookieName,
          secure: cookieSecure,
        });
        if (!session) {
          sendJson(response, 503, unavailable());
          return;
        }
        if (
          await handleBridge(request, response, path, {
            siteId,
            siteCredential: options.siteCredential,
            audience: options.audience,
            decisionTimeoutMs,
            clearanceCookieName: cookieName,
            cookieSecure,
            limits,
            services,
            session,
            store,
            verificationKeys: options.verificationKeys,
            now,
          })
        ) {
          return;
        }
      }

      const context = buildRequestContext({
        request,
        path,
        siteId,
        trustedProxy: options.trustedProxy,
      });
      if (!context) {
        options.onEvent?.({ type: "invalid_request", route });
        sendJson(response, 400, invalidRequest());
        return;
      }
      if (
        context.method === "OPTIONS" ||
        isInfrastructureExcluded(path)
      ) {
        await options.handle(request, response, {
          advisory: false,
          status: "excluded",
        });
        return;
      }

      const session = await resolveGateSession({
        request,
        response,
        store,
        cookieName: sessionCookieName,
        secure: cookieSecure,
      });
      if (!session) {
        options.onEvent?.({
          type: "decision_unavailable",
          reason: "dependency_unavailable",
        });
        await options.handle(request, response, {
          advisory: true,
          status: "unavailable",
          recommendation: unavailableSnapshot(),
        });
        return;
      }
      session.requestContext ??= context;
      await store.set(session);
      if (
        session.recommendation?.lifecycle === "offline" &&
        session.initialBrowser &&
        !session.pendingDecision &&
        (session.offlineUntil ?? 0) <= now()
      ) {
        void beginDecision({
          context: session.requestContext,
          initialBrowser: session.initialBrowser,
          siteCredential: options.siteCredential,
          decisionTimeoutMs,
          session,
          services,
          save: () => Promise.resolve(store.set(session)),
        });
      }
      const clearance = verifyClearanceCookie({
        value: readCookie(request, cookieName),
        verificationKeys: options.verificationKeys,
        audience: options.audience,
        siteId,
        gateSessionId: session.id,
        now: now(),
      });
      const hadLocalClearance = session.clearanceVerified === true;
      session.clearanceVerified = false;
      if (clearance.valid && session.activeChallenge === undefined) {
        session.clearanceVerified = true;
        session.recommendation = allowSnapshot(session.lastApplied);
        await store.set(session);
        await options.handle(request, response, advisoryState(session));
        return;
      }
      if (
        hadLocalClearance &&
        !session.lastApplied &&
        !session.visitorToken &&
        session.activeChallenge === undefined
      ) {
        session.recommendation = checkingSnapshot(false);
      }
      session.recommendation ??= checkingSnapshot(false, session.lastApplied);
      await store.set(session);
      await options.handle(request, response, advisoryState(session));
    } catch {
      options.onEvent?.({ type: "request_error", route });
      if (!response.headersSent) sendJson(response, 500, unavailable());
      else response.destroy();
    }
  };
}

export function createPowerOtpServer(options: GateNodeOptions): Server {
  const maxHeaderSize = options.limits?.maxHeaderBytes ?? DEFAULT_LIMITS.maxHeaderBytes;
  return createServer(
    { maxHeaderSize, requireHostHeader: true },
    createPowerOtpRequestListener(options),
  );
}

function validateLimits(limits: typeof DEFAULT_LIMITS): void {
  if (
    !Number.isSafeInteger(limits.maxHeaderCount) ||
    limits.maxHeaderCount < 1 ||
    limits.maxHeaderCount > 1_000
  ) {
    throw new TypeError("maxHeaderCount must be an integer from 1 through 1000");
  }
  for (const [name, value] of Object.entries(limits).filter(
    ([name]) => name !== "maxHeaderCount",
  )) {
    if (!Number.isSafeInteger(value) || value < 256 || value > 1_048_576) {
      throw new TypeError(`${name} must be an integer from 256 through 1048576`);
    }
  }
}

function invalidRequest() {
  return {
    status: "error" as const,
    code: "invalid_request" as const,
    message: "Invalid request",
  };
}

function unavailable() {
  return {
    status: "unavailable" as const,
    reason: "dependency_unavailable" as const,
    message: "Request unavailable",
    retryable: true,
  };
}
