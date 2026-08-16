import { BrowserAssessmentRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { runtimeMutation } from "@/lib/botblocker-http";

interface RouteParams {
  params: Promise<{ webhookId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { webhookId } = await params;
  return runtimeMutation(
    request,
    BrowserAssessmentRequestSchema,
    "browser-assessment",
    webhookId,
    async (body, site, context) => {
      await context.botBlockerIngestion.ingestBrowserAssessment(
        site,
        body.payload.report,
        body.audience,
      );
    },
  );
});
