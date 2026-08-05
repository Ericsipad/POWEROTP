import { ApiError } from "@powerotp/api/errors.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const POST = apiRoute(async (request) => {
  const { auth, projects, config } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  if (!config.DEMO_PROJECT_SLUG) throw new ApiError("demo_not_configured", 409);
  const project = await projects.ensureDemoProject(
    config.DEMO_PROJECT_SLUG,
    new URL(config.PUBLIC_APP_URL).origin,
    authenticated.user._id,
  );

  const response = NextResponse.json({ project });
  response.headers.set("cache-control", "no-store");
  return response;
});
