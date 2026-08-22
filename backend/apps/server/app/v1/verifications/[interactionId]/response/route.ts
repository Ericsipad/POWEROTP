import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { tokenActionForType, verifyInteractionToken } from "@powerotp/api/interaction-tokens.js";
import { authenticateApiKey } from "@powerotp/api/project-api-auth.js";
import { ChallengeSubmissionSchema, CodeSubmissionSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

/**
 * Shared response endpoint for every method that collects an answer after
 * creation: `voice_code`/`sms_code` (a five-digit code) and
 * `voice_challenge` (a set of opaque option IDs). Which schema and
 * `VerificationService` method applies is branched on the verification's
 * own type, fetched once up front, rather than duplicating this route per
 * method.
 */
export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, verifications } = await getServerContext();
  const { interactionId } = await params;
  const sourceIp = clientIp(request);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:response:${sourceIp ?? "unknown"}`,
    20,
    60,
  );

  const verification = await verifications.get(interactionId);
  if (!verification) throw new ApiError("verification_not_found", 404);

  const tokenAction = tokenActionForType(verification.type);
  if (!tokenAction) throw new ApiError("unsupported_response_type", 400);

  const interactionTokenHeader = request.headers.get("x-interaction-token");
  if (interactionTokenHeader) {
    const origin = request.headers.get("origin") ?? "";
    const claims = verifyInteractionToken(interactionTokenHeader, config.INTERACTION_TOKEN_SECRET, {
      projectId: verification.projectId,
      interactionId,
      action: tokenAction,
      audience: origin,
    });
    const consumed = await verifications.consumeInteractionToken(interactionId, claims.nonce);
    if (!consumed) throw new ApiError("interaction_token_replayed", 409);
  } else {
    const project = await authenticateApiKey(
      dataStores.db,
      config,
      request.headers.get("authorization") ?? undefined,
      sourceIp,
    );
    if (project._id !== verification.projectId) {
      throw new ApiError("verification_not_found", 404);
    }
  }

  const requestBody = await request.json();
  const result =
    verification.type === "voice_challenge"
      ? await verifications.submitChallenge(
          interactionId,
          parseBody(ChallengeSubmissionSchema, requestBody).optionIds,
        )
      : await verifications.submitCode(interactionId, parseBody(CodeSubmissionSchema, requestBody).code);

  const response = NextResponse.json(result);
  response.headers.set("cache-control", "no-store");
  return response;
});
