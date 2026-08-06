import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ nodeId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, nodes } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { nodeId } = await params;
  const node = await nodes.revoke(authenticated.user._id, nodeId);

  const response = NextResponse.json({ node });
  response.headers.set("cache-control", "no-store");
  return response;
});
