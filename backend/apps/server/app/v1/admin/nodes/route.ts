import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/**
 * Read-only: a node's identity is the shared `NODE_SECRET` App Platform env
 * var (see `backend/packages/api/src/node-service.ts`), so there is nothing to create
 * or revoke here. This just lists which source IPs have actually
 * authenticated, for visibility.
 */
export const GET = apiRoute(async (request) => {
  const { auth, nodes } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({ nodes: await nodes.list() });
  response.headers.set("cache-control", "no-store");
  return response;
});
