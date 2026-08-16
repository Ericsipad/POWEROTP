import { CompleteChallengeRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import {
  botBlockerError,
  unavailableRuntimeMutation,
} from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string; challengeId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId, challengeId } = await params;
  if (challengeId.length < 16) return botBlockerError("invalid_request", 400);
  return unavailableRuntimeMutation(
    request,
    CompleteChallengeRequestSchema,
    "challenge-complete",
    webhookId,
    challengeId,
  );
});
