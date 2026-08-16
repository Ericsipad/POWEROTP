import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { clearSessionCookies, SESSION_COOKIE } from "@/lib/session-cookies";

export const POST = apiRoute(async (request) => {
  const { auth } = await getServerContext();
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await auth.authenticate(sessionToken);
  auth.verifyCsrf(authenticated.session, request.headers.get("x-csrf-token") ?? undefined);
  await auth.logout(sessionToken);

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
});
