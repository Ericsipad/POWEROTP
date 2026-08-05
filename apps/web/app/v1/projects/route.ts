import { parseBody } from "@powerotp/api/errors.js";
import { CreateProjectSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const response = NextResponse.json({ projects: await projects.list(authenticated.user._id) });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const created = await projects.create(
    authenticated.user._id,
    parseBody(CreateProjectSchema, await request.json()),
    clientIp(request),
  );
  const response = NextResponse.json(created, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
