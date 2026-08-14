import {
  CustomerVisitorsQuerySchema,
  CustomerVisitorsResponseSchema,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, botBlockerOperations, dataStores } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const { projectId } = await params;
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:botblocker-visitors:${authenticated.user._id}:${projectId}:${clientIp(request) ?? "unknown"}`,
    120,
    60,
  );
  const parsed = CustomerVisitorsQuerySchema.safeParse({
    siteId: request.nextUrl.searchParams.get("siteId") ?? undefined,
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    limit: request.nextUrl.searchParams.has("limit")
      ? Number(request.nextUrl.searchParams.get("limit"))
      : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const before = parsed.data.cursor
    ? new Date(parsed.data.cursor)
    : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const body = CustomerVisitorsResponseSchema.parse(
    await botBlockerOperations.visitors(
      authenticated.user._id,
      projectId,
      {
        limit: parsed.data.limit,
        ...(before ? { before } : {}),
        ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
      },
    ),
  );
  const response = NextResponse.json(body);
  response.headers.set("cache-control", "no-store");
  return response;
});
