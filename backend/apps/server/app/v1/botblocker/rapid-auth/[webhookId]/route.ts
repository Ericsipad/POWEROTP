import { RapidAuthRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { rapidAuthMutation } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId } = await params;
  return rapidAuthMutation(request, webhookId, RapidAuthRequestSchema);
});
