import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * Customer-facing equivalent of the admin-only
 * `GET /v1/admin/widget-interactions` — scoped to one project the caller
 * actually owns, backing the dashboard's own "Visitors" tab (see
 * `docs/AS_BUILT.md`'s "Customer signup flow"/dashboard section). Same
 * underlying data (real end-user IP/User-Agent captured from the hosted
 * verification modal, visibility only — no threat score yet).
 */
export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects, verifications } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);

  const { projectId } = await params;
  await projects.assertOwned(authenticated.user._id, projectId);
  const response = NextResponse.json({
    interactions: await verifications.projectWidgetInteractions(projectId),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
