import { RiskEventsRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { runtimeMutation } from "@/lib/botblocker-http";

export const POST = apiRoute((request) =>
  runtimeMutation(
    request,
    RiskEventsRequestSchema,
    "risk-events",
    async (body, site, context) => {
      await context.botBlockerIngestion.ingestRiskEvents(
        site,
        body.payload.batch,
      );
    },
  ),
);
