import { CanonicalReportRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { reportMutation } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId } = await params;
  return reportMutation(request, webhookId, CanonicalReportRequestSchema);
});
