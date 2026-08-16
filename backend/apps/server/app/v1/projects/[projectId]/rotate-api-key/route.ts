import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { projectId } = await params;
  const value = await projects.rotateApiKey(authenticated.user._id, projectId, clientIp(request));
  const response = NextResponse.json({ value });
  response.headers.set("cache-control", "no-store");
  return response;
});
