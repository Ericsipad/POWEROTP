import { apiRoute } from "@/lib/api-route";
import { unavailableChallengeRead } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ challengeId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { challengeId } = await params;
  return unavailableChallengeRead(request, challengeId);
});
