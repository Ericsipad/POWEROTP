import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Node-facing, not admin-facing: a telephony droplet authenticates with
 * the shared `NODE_SECRET` (never an admin session) and pulls the
 * outbound trunk configuration currently set in App Platform. Polling this
 * also refreshes the node's `lastSeenAt` heartbeat as a side effect of
 * `NodeService.authenticate`.
 */
export const GET = apiRoute(async (request) => {
  const { nodes } = await getServerContext();
  await nodes.authenticate(request.headers.get("authorization") ?? undefined, clientIp(request));

  const response = NextResponse.json(nodes.configFor());
  response.headers.set("cache-control", "no-store");
  return response;
});
