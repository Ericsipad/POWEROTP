import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { SESSION_COOKIE, CSRF_COOKIE, sessionUser } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth } = await getServerContext();
  const authenticated = await auth.authenticate(request.cookies.get(SESSION_COOKIE)?.value);
  const csrfToken = request.cookies.get(CSRF_COOKIE)?.value;
  auth.verifyCsrf(authenticated.session, csrfToken);
  return NextResponse.json({ user: sessionUser(authenticated.user), csrfToken });
});
