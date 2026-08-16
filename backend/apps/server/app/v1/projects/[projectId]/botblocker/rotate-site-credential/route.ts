import { ApiError } from "@powerotp/api/errors.js";
import { BotBlockerCredentialRotationResponseSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireCustomerSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const {
    auth,
    botBlockerSites,
    botBlockerSiteCredentials,
    dataStores,
  } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const ip = clientIp(request);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:botblocker-credential-rotation:${authenticated.user._id}:${ip ?? "unknown"}`,
    10,
    3_600,
  );

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) throw new ApiError("idempotency_key_required", 400);
  const { projectId } = await params;
  await botBlockerSites.get(authenticated.user._id, projectId);
  const credential = await botBlockerSiteCredentials.rotate(
    authenticated.user._id,
    projectId,
    idempotencyKey,
    ip,
  );
  const response = NextResponse.json(
    BotBlockerCredentialRotationResponseSchema.parse(credential),
    { status: 201 },
  );
  response.headers.set("cache-control", "no-store");
  return response;
});
