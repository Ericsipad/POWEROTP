import { PaidTokenPassAssertionRequestSchema } from "@powerotp/contracts";

import { apiRoute } from "@/lib/api-route";
import { unavailableRuntimeMutation } from "@/lib/botblocker-http";

export const POST = apiRoute((request) =>
  unavailableRuntimeMutation(
    request,
    PaidTokenPassAssertionRequestSchema,
    "paid-pass-assert",
  ),
);
