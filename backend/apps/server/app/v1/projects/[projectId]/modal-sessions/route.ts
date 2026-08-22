import { parseBody } from "@powerotp/api/errors.js";
import { authenticateProjectApiKey } from "@powerotp/api/project-api-auth.js";
import { modalSessionUrl } from "@powerotp/api/public-urls.js";
import { ModalSessionCreateSchema, type ModalSessionAccepted } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  /** Despite the folder name, this is the project *slug*, not its internal id. */
  params: Promise<{ projectId: string }>;
}

/**
 * Creates a short-lived, single-purpose "modal session" a customer's own
 * backend uses to hand a POWEROTP-hosted verification modal to its end
 * user — see `docs/AS_BUILT.md`'s "Hosted verification modal" section. The
 * end user types their own phone number into that hosted page; this route
 * never takes a `targetNumber` at all.
 */
export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, modalSessions } = await getServerContext();
  const { projectId: slug } = await params;
  const sourceIp = clientIp(request);

  const project = await authenticateProjectApiKey(
    dataStores.db,
    config,
    slug,
    request.headers.get("authorization") ?? undefined,
    sourceIp,
  );
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:modal-sessions:${sourceIp ?? "unknown"}`,
    30,
    60,
  );

  const rawBody = await request.text();
  const input = parseBody(ModalSessionCreateSchema, rawBody ? JSON.parse(rawBody) : {});

  const session = await modalSessions.createSession(project, input.allowedTypes);

  const body: ModalSessionAccepted = {
    sessionId: session._id,
    modalUrl: modalSessionUrl(config.PUBLIC_APP_URL, session._id),
    expiresAt: session.expiresAt.toISOString(),
  };
  const response = NextResponse.json(body, { status: 202 });
  response.headers.set("cache-control", "no-store");
  return response;
});
