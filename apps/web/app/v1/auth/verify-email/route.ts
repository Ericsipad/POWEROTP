import { parseBody } from "@powerotp/api/errors.js";
import { VerifyEmailSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp, requireAllowedOrigin } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

export const POST = apiRoute(async (request) => {
  const { auth, config, dataStores } = await getServerContext();
  requireAllowedOrigin(request, config.PUBLIC_APP_URL);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:verify-email:${clientIp(request) ?? "unknown"}`,
    10,
    60,
  );

  const { token } = parseBody(VerifyEmailSchema, await request.json());
  await auth.verifyEmail(token);
  return new NextResponse(null, { status: 204 });
});
