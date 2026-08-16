import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/**
 * Read-only admin visibility into recent real end-user widget
 * interactions — `endUserIp`/`endUserUserAgent` captured directly from the
 * end user's own browser request to the hosted modal (see
 * `docs/AS_BUILT.md`'s "Hosted verification modal" section). Visibility/
 * audit only for now, no fraud/risk scoring attached to this yet.
 */
export const GET = apiRoute(async (request) => {
  const { auth, verifications } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({
    interactions: await verifications.recentWidgetInteractions(50),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
