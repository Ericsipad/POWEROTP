import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/**
 * Read-only, platform-wide verification totals (across every project) for
 * the admin "operator health" usage view — see
 * `apps/api/src/verification-reporting.ts#computePlatformStats` and
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section. A single
 * customer's own totals are already available on their own dashboard via
 * `Project#stats`; this is the platform-wide equivalent for the admin.
 */
export const GET = apiRoute(async (request) => {
  const { auth, verifications } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({ stats: await verifications.platformStats() });
  response.headers.set("cache-control", "no-store");
  return response;
});
