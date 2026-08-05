import { parseBody } from "@powerotp/api/errors.js";
import { UpdateProjectSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const PATCH = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { projectId } = await params;
  const updated = await projects.update(
    authenticated.user._id,
    projectId,
    parseBody(UpdateProjectSchema, await request.json()),
    clientIp(request),
  );
  return NextResponse.json(updated);
});
