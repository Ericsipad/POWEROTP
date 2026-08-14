import { apiRoute } from "@/lib/api-route";
import { botBlockerPolicyHttpResponse } from "@/lib/botblocker-policy-http";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ siteId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { siteId } = await params;
  const { botBlockerPolicy } = await getServerContext();
  const result = await botBlockerPolicy.getPolicy(siteId);
  return botBlockerPolicyHttpResponse(request.headers.get("if-none-match"), result);
});
