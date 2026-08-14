import { OperatorDecisionTraceResponseSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ gateSessionId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, botBlockerOperations, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:botblocker-control-trace:${authenticated.user._id}:${clientIp(request) ?? "unknown"}`,
    120,
    60,
  );
  const { gateSessionId } = await params;
  const body = OperatorDecisionTraceResponseSchema.parse(
    await botBlockerOperations.decisionTrace(
      authenticated.user._id,
      gateSessionId,
      clientIp(request),
    ),
  );
  const response = NextResponse.json(body);
  response.headers.set("cache-control", "no-store");
  return response;
});
