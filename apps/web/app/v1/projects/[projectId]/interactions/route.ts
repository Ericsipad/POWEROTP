import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects, verifications } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);

  const { projectId } = await params;
  await projects.assertOwned(authenticated.user._id, projectId);
  const response = NextResponse.json({ interactions: await verifications.listInteractions(projectId) });
  response.headers.set("cache-control", "no-store");
  return response;
});
