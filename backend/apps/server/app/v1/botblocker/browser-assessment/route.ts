import { BrowserAssessmentRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { unavailableRuntimeMutation } from "@/lib/botblocker-http";

export const POST = apiRoute((request) =>
  unavailableRuntimeMutation(
    request,
    BrowserAssessmentRequestSchema,
    "browser-assessment",
  ),
);
