import { parseBody } from "@powerotp/api/errors.js";
import { UpdateHostedAuthProjectSettingsSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const { projectId } = await params;
  const response = NextResponse.json(
    await projects.getAuthSettings(authenticated.user._id, projectId),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const PATCH = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const { projectId } = await params;
  const response = NextResponse.json(
    await projects.updateAuthSettings(
      authenticated.user._id,
      projectId,
      parseBody(UpdateHostedAuthProjectSettingsSchema, await request.json()),
      clientIp(request),
    ),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});
