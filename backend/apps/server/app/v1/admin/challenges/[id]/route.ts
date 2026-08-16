import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Soft-retires a challenge: it stops being selected for new interactions,
 * but any interaction that already bound its own immutable snapshot (see
 * `backend/packages/api/src/challenge-service.ts#selectAndMaterialize`) is unaffected.
 */
export const DELETE = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, challenges } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { id } = await params;
  await challenges.retireChallenge(id, authenticated.user._id);
  const response = NextResponse.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  return response;
});
