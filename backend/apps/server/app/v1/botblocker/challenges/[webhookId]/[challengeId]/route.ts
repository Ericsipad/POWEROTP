import { apiRoute } from "@/lib/api-route";
import { unavailableChallengeRead } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string; challengeId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId, challengeId } = await params;
  return unavailableChallengeRead(request, webhookId, challengeId);
});
