import { ApiError } from "@powerotp/api/errors.js";
import { WIDGET_STATUS_TOKEN_AUDIENCE, verifyInteractionToken } from "@powerotp/api/interaction-tokens.js";
import { authenticateApiKey } from "@powerotp/api/project-api-auth.js";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

/**
 * Two ways to read status: a project's own server with its API key (the
 * original design), or a browser holding a `view_status` interaction
 * token — the latter is what the hosted verification modal
 * (`frontend/app/widget/[sessionId]/page.tsx`) polls with, since it never
 * has and must never receive a project's API key. Unlike the response
 * route's `submit_code`/`submit_challenge` tokens, a `view_status` token is
 * never single-use consumed here — polling the same interaction's status
 * repeatedly is expected, not a replay.
 */
export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, verifications } = await getServerContext();
  const { interactionId } = await params;

  const verification = await verifications.get(interactionId);
  if (!verification) throw new ApiError("verification_not_found", 404);

  const interactionTokenHeader = request.headers.get("x-interaction-token");
  if (interactionTokenHeader) {
    verifyInteractionToken(interactionTokenHeader, config.INTERACTION_TOKEN_SECRET, {
      projectId: verification.projectId,
      interactionId,
      action: "view_status",
      audience: WIDGET_STATUS_TOKEN_AUDIENCE,
    });
  } else {
    const project = await authenticateApiKey(
      dataStores.db,
      config,
      request.headers.get("authorization") ?? undefined,
      clientIp(request),
    );
    if (project._id !== verification.projectId) {
      throw new ApiError("verification_not_found", 404);
    }
  }

  const response = NextResponse.json(verifications.toStatus(verification));
  response.headers.set("cache-control", "no-store");
  return response;
});
