import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/**
 * Read-only visibility into recent callback delivery attempts (both
 * delivered and failed), most recent first — see
 * `backend/packages/api/src/callback-worker.ts` (which already records every attempt)
 * and `docs/AS_BUILT.md`'s "Admin operator health dashboard" section.
 * Nothing to retry or configure here, callback diagnostics visibility
 * only, per explicit scope for this session.
 */
export const GET = apiRoute(async (request) => {
  const { auth, verifications } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({
    deliveries: await verifications.recentCallbackDeliveries(50),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
