import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Soft-retires a recording: it stops appearing in the media manifest and
 * can no longer back a new challenge, but the immutable Spaces object and
 * any challenge already referencing it are left untouched — an in-flight
 * interaction bound to that challenge keeps working.
 */
export const DELETE = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, challenges } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { id } = await params;
  await challenges.retireRecording(id, authenticated.user._id);
  const response = NextResponse.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  return response;
});
