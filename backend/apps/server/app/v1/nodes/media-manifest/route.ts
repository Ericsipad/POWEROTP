import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Node-facing media manifest for `voice_challenge` (Type 3), authenticated
 * the same way as `/v1/nodes/config` — the shared `NODE_SECRET`, no
 * per-node identity. `204` means there is nothing published yet (no
 * Spaces/manifest-secret configuration, or no published challenge
 * currently references a recording) — the agent's media-sync loop treats
 * that as "nothing to do" rather than an error. See
 * `backend/packages/api/src/challenge-service.ts#currentManifest` and
 * `apps/telephony-agent/src/media-sync.ts`.
 */
export const GET = apiRoute(async (request) => {
  const { nodes, challenges } = await getServerContext();
  await nodes.authenticate(request.headers.get("authorization") ?? undefined, clientIp(request));

  const manifest = await challenges.currentManifest();
  if (!manifest) {
    return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  const response = NextResponse.json(manifest);
  response.headers.set("cache-control", "no-store");
  return response;
});
