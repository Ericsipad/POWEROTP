import { parseBody } from "@powerotp/api/errors.js";
import { CustomerRegistrationSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp, requireAllowedOrigin } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

export const POST = apiRoute(async (request) => {
  const { auth, config, dataStores } = await getServerContext();
  requireAllowedOrigin(request, config.PUBLIC_APP_URL);
  await enforceRateLimit(dataStores.rateLimitStore, `rl:register:${clientIp(request) ?? "unknown"}`, 5, 60);

  await auth.register(parseBody(CustomerRegistrationSchema, await request.json()));
  return NextResponse.json({ status: "verification_email_queued" }, { status: 202 });
});
