import { apiRoute } from "@/lib/api-route";
import { botBlockerSessionDataRead } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId } = await params;
  return botBlockerSessionDataRead(request, webhookId);
});
