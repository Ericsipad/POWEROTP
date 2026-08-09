import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  WIDGET_STATUS_TOKEN_AUDIENCE,
  issueInteractionToken,
  tokenActionForType,
} from "@powerotp/api/interaction-tokens.js";
import {
  ModalSessionVerificationRequestSchema,
  type ModalSessionVerificationAccepted,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * Public: the session id is the credential. This is where the end user's
 * own phone number (typed into the hosted `/widget/{sessionId}` page)
 * first reaches the platform — see `docs/AS_BUILT.md`'s "Hosted
 * verification modal" section. Always creates the interaction with
 * `browserResponse: true` and always mints an interaction token, since the
 * modal itself (not the customer's backend) submits the follow-up code/
 * challenge response using the existing, unchanged
 * `GET /v1/verifications/{id}` and `POST /v1/verifications/{id}/response`
 * routes.
 */
export const POST = apiRoute<RouteParams>(async (request, { params }, correlationId) => {
  const { config, dataStores, modalSessions, verifications } = await getServerContext();
  const { sessionId } = await params;

  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:modal-session-verifications:${clientIp(request) ?? "unknown"}`,
    20,
    60,
  );
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:modal-session-verifications-session:${sessionId}`,
    20,
    60,
  );

  const input = parseBody(ModalSessionVerificationRequestSchema, await request.json());
  const session = await modalSessions.recordAttempt(sessionId);
  if (!session.allowedTypes.includes(input.type)) {
    throw new ApiError("method_not_enabled", 403);
  }

  const accepted = await verifications.create(
    session.projectId,
    session.customerId,
    { ...input, browserResponse: true },
    crypto.randomUUID(),
    correlationId,
  );

  // Captured directly from the end user's own browser request — never
  // from anything the customer's own site could set, since that would be
  // trivially spoofable. Visibility/audit only; see
  // `docs/AS_BUILT.md`'s "Hosted verification modal" section.
  await verifications.recordEndUserMeta(accepted.interactionId, {
    endUserIp: clientIp(request),
    endUserUserAgent: request.headers.get("user-agent") ?? undefined,
  });

  // Always issued, regardless of type (even `call_reachability`, which has
  // no response step at all) — the modal polls status with this token
  // since it never holds a project API key. Read-only: never single-use
  // consumed, unlike the submit-action token below.
  const statusToken = issueInteractionToken(config.INTERACTION_TOKEN_SECRET, {
    projectId: session.projectId,
    interactionId: accepted.interactionId,
    action: "view_status",
    audience: WIDGET_STATUS_TOKEN_AUDIENCE,
  }).token;

  const tokenAction = tokenActionForType(input.type);
  let interactionToken: string | undefined;
  if (tokenAction) {
    const issued = issueInteractionToken(config.INTERACTION_TOKEN_SECRET, {
      projectId: session.projectId,
      interactionId: accepted.interactionId,
      action: tokenAction,
      audience: new URL(config.PUBLIC_APP_URL).origin,
    });
    await verifications.attachInteractionToken(accepted.interactionId, issued.nonce);
    interactionToken = issued.token;
  }

  const body: ModalSessionVerificationAccepted = {
    interactionId: accepted.interactionId,
    state: "queued",
    statusUrl: accepted.statusUrl,
    expiresAt: accepted.expiresAt,
    statusToken,
    interactionToken,
  };
  const response = NextResponse.json(body, { status: 202 });
  response.headers.set("cache-control", "no-store");
  return response;
});
