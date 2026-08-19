import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  BotBlockerDataReadyCallbackEnvelopeSchema,
  BotBlockerSessionDataResponseSchema,
} from "@powerotp/contracts";

import { readRawJsonBody, sendJson } from "./http.js";
import type {
  GateNodeLimits,
  GateNodeServices,
  GateSessionStore,
} from "./types.js";

export const PROJECT_CALLBACK_PATH =
  "/_powerotp/webhooks/challenge-status";
const CALLBACK_FRESHNESS_MS = 5 * 60 * 1_000;

export async function handleProjectCallback(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: {
    projectId?: string;
    siteId: string;
    callbackSigningSecret?: string;
    limits: Required<GateNodeLimits>;
    services: GateNodeServices;
    store: GateSessionStore;
    now(): number;
  },
): Promise<boolean> {
  if (path !== PROJECT_CALLBACK_PATH) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { status: "error", code: "invalid_request" });
    return true;
  }
  if (!options.projectId || !options.callbackSigningSecret) {
    sendJson(response, 503, unavailable());
    return true;
  }

  try {
    const { raw, parsed } = await readRawJsonBody(
      request,
      options.limits.maxBodyBytes,
    );
    const signature = request.headers["powerotp-signature"];
    if (
      typeof signature !== "string" ||
      !verifyProjectCallbackSignature(
        raw,
        options.callbackSigningSecret,
        signature,
        options.now(),
      )
    ) {
      sendJson(response, 401, { status: "error", code: "invalid_request" });
      return true;
    }
    const envelope =
      BotBlockerDataReadyCallbackEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      sendJson(response, 400, { status: "error", code: "invalid_request" });
      return true;
    }
    const event = envelope.data.event;
    if (
      event.projectId !== options.projectId ||
      event.siteId !== options.siteId
    ) {
      sendJson(response, 403, { status: "error", code: "invalid_request" });
      return true;
    }
    const session = await options.store.get(event.gateSessionId);
    if (!session?.visitorToken) {
      sendJson(response, 503, unavailable());
      return true;
    }
    if (
      session.acceptedCallbackEventIds?.includes(event.eventId) ||
      session.acceptedCallbackNonces?.includes(event.nonce)
    ) {
      sendJson(response, 409, { status: "error", code: "invalid_request" });
      return true;
    }
    const pulled = await options.services.pullSessionData(
      event,
      { visitorToken: session.visitorToken },
      session,
    );
    const data = BotBlockerSessionDataResponseSchema.safeParse(pulled);
    if (
      !data.success ||
      data.data.eventId !== event.eventId ||
      data.data.projectId !== event.projectId ||
      data.data.siteId !== event.siteId ||
      data.data.gateSessionId !== event.gateSessionId
    ) {
      sendJson(response, 503, unavailable());
      return true;
    }
    const applied = await options.store.applyDataReady(event, data.data);
    if (applied !== "applied") {
      sendJson(
        response,
        applied === "session_not_found" ? 503 : 409,
        applied === "session_not_found"
          ? unavailable()
          : { status: "error", code: "invalid_request" },
      );
      return true;
    }
    sendJson(response, 202, { status: "accepted", eventId: event.eventId });
    return true;
  } catch {
    sendJson(response, 503, unavailable());
    return true;
  }
}

export function verifyProjectCallbackSignature(
  body: string,
  secret: string,
  header: string,
  now = Date.now(),
): boolean {
  const match = /^t=(\d+),v1=([A-Za-z0-9_-]+)$/.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > CALLBACK_FRESHNESS_MS
  ) {
    return false;
  }
  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("base64url"),
  );
  const actual = Buffer.from(match[2]!);
  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}

function unavailable() {
  return {
    status: "unavailable" as const,
    reason: "dependency_unavailable" as const,
    message: "Request unavailable",
    retryable: true,
  };
}
