import { AgentEntitlementRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { unavailableRuntimeMutation } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId } = await params;
  return unavailableRuntimeMutation(
    request,
    AgentEntitlementRequestSchema,
    "agent-entitlements",
    webhookId,
  );
});
