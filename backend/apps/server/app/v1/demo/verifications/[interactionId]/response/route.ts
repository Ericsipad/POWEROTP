import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { ChallengeSubmissionSchema, CodeSubmissionSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { requireDemoProject } from "@/lib/demo-project";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

/**
 * Public, demo-project-scoped counterpart to the real, API-key/interaction-
 * token-gated `POST /v1/verifications/{id}/response` — lets the public
 * marketing-site "try it now" widget actually submit the code/challenge
 * answer the visitor received, the same way the hosted verification modal
 * does for a real project, instead of only ever watching status. Scoped
 * exactly like the existing demo create/status routes: anonymous, but only
 * for the one operator-configured demo project, never a customer's own.
 */
export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const context = await getServerContext();
  await enforceRateLimit(
    context.dataStores.rateLimitStore,
    `rl:demo-response:${clientIp(request) ?? "unknown"}`,
    20,
    60,
  );
  const project = await requireDemoProject(context);

  const { interactionId } = await params;
  const verification = await context.verifications.get(interactionId);
  if (!verification || verification.projectId !== project._id) {
    throw new ApiError("verification_not_found", 404);
  }

  const requestBody = await request.json();
  const result =
    verification.type === "voice_challenge"
      ? await context.verifications.submitChallenge(
          interactionId,
          parseBody(ChallengeSubmissionSchema, requestBody).optionIds,
        )
      : await context.verifications.submitCode(
          interactionId,
          parseBody(CodeSubmissionSchema, requestBody).code,
        );

  const response = NextResponse.json(result);
  response.headers.set("cache-control", "no-store");
  return response;
});
