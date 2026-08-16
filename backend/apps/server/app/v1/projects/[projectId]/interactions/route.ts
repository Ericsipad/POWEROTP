import { VerificationTypeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/** `?type=` optionally filters to one verification type — backs the
 * dashboard's own per-type tab history table (see
 * `frontend/app/dashboard/verification-tabs.tsx`), which reuses this same
 * route/table rather than a separate endpoint per type. */
export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects, verifications } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);

  const { projectId } = await params;
  await projects.assertOwned(authenticated.user._id, projectId);
  const typeParam = new URL(request.url).searchParams.get("type");
  const type = VerificationTypeSchema.safeParse(typeParam).success
    ? VerificationTypeSchema.parse(typeParam)
    : undefined;
  const response = NextResponse.json({
    interactions: await verifications.listInteractions(projectId, 50, type),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
