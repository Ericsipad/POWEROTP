import { ApiError } from "@powerotp/api/errors.js";
import type { ProjectDocument } from "@powerotp/api/persistence.js";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * Public: the session id itself is the credential (unguessable, minted by
 * `ModalSessionService.createSession`), not a project API key — this is
 * what the hosted `/widget/{sessionId}` page fetches on load to know which
 * methods to offer and how many attempts remain. Never returns anything a
 * project's own API key would (no callback URL, no raw project id).
 */
export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { dataStores, modalSessions } = await getServerContext();
  const { sessionId } = await params;

  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:modal-session-status:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );

  const session = await modalSessions.get(sessionId);

  const project = await dataStores.db
    .collection<ProjectDocument>("projects")
    .findOne({ _id: session.projectId });
  if (!project) throw new ApiError("modal_session_not_found", 404);

  const config = await modalSessions.config(sessionId, project.name);
  const response = NextResponse.json(config);
  response.headers.set("cache-control", "no-store");
  return response;
});
