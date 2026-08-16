import { OperatorBotBlockerHealthResponseSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, botBlockerOperations, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:botblocker-control-health:${authenticated.user._id}:${clientIp(request) ?? "unknown"}`,
    120,
    60,
  );
  const body = OperatorBotBlockerHealthResponseSchema.parse(
    await botBlockerOperations.health(),
  );
  const response = NextResponse.json(body);
  response.headers.set("cache-control", "no-store");
  return response;
});
