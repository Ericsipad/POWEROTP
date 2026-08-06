import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Node-facing, not admin-facing: a telephony droplet authenticates with
 * its own bearer secret (never an admin session) and pulls only the
 * outbound trunk configuration currently set in App Platform. Polling this
 * also refreshes the node's `lastSeenAt` heartbeat as a side effect of
 * `NodeService.authenticate`.
 */
export const GET = apiRoute(async (request) => {
  const { nodes } = await getServerContext();
  const node = await nodes.authenticate(request.headers.get("authorization") ?? undefined);

  const response = NextResponse.json(nodes.configFor(node));
  response.headers.set("cache-control", "no-store");
  return response;
});
