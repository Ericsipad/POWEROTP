import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { verifyInteractionToken } from "@powerotp/api/interaction-tokens.js";
import { authenticateApiKey } from "@powerotp/api/project-api-auth.js";
import { CodeSubmissionSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, verifications } = await getServerContext();
  const { interactionId } = await params;
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:response:${clientIp(request) ?? "unknown"}`,
    20,
    60,
  );

  const { code } = parseBody(CodeSubmissionSchema, await request.json());
  const verification = await verifications.get(interactionId);
  if (!verification) throw new ApiError("verification_not_found", 404);

  const interactionTokenHeader = request.headers.get("x-interaction-token");
  if (interactionTokenHeader) {
    const origin = request.headers.get("origin") ?? "";
    const claims = verifyInteractionToken(interactionTokenHeader, config.INTERACTION_TOKEN_SECRET, {
      projectId: verification.projectId,
      interactionId,
      action: "submit_code",
      audience: origin,
    });
    const consumed = await verifications.consumeInteractionToken(interactionId, claims.nonce);
    if (!consumed) throw new ApiError("interaction_token_replayed", 409);
  } else {
    const project = await authenticateApiKey(
      dataStores.db,
      config,
      request.headers.get("authorization") ?? undefined,
    );
    if (project._id !== verification.projectId) {
      throw new ApiError("verification_not_found", 404);
    }
  }

  const response = NextResponse.json(await verifications.submitCode(interactionId, code));
  response.headers.set("cache-control", "no-store");
  return response;
});
