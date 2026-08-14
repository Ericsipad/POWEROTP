import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { BotBlockerPolicyPublicationError } from "@powerotp/api/botblocker-policy-service.js";
import {
  OperatorPolicyPublicationRequestSchema,
  OperatorPolicyPublicationResponseSchema,
  OperatorPolicyReleaseListResponseSchema,
  PolicyReleaseRecordSchema,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import {
  botBlockerError,
  botBlockerUnavailable,
} from "@/lib/botblocker-http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireAdminSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, botBlockerPolicyControl, dataStores } =
    await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(
    request,
    dataStores.rateLimitStore,
    authenticated.user._id,
  );
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) return botBlockerError("invalid_request", 400);
  const releases = await botBlockerPolicyControl.list(siteId);
  if (!releases) return botBlockerError("unknown_site", 404);
  const response = NextResponse.json(
    OperatorPolicyReleaseListResponseSchema.parse({
      releases: releases.map((release) =>
        PolicyReleaseRecordSchema.parse(release),
      ),
    }),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, botBlockerPolicyControl, dataStores } =
    await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(
    request,
    dataStores.rateLimitStore,
    authenticated.user._id,
  );
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorPolicyPublicationRequestSchema,
    await request.json(),
  );
  try {
    const release = await botBlockerPolicyControl.publish(
      authenticated.user._id,
      input.policy,
      clientIp(request),
    );
    const body = OperatorPolicyPublicationResponseSchema.parse({ release });
    const response = NextResponse.json(body, { status: 201 });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof BotBlockerPolicyPublicationError) {
      return botBlockerError(error.code, error.code === "unknown_site" ? 404 : 409);
    }
    if (
      error instanceof Error &&
      error.message === "BotBlocker signing is not configured"
    ) {
      return botBlockerUnavailable("policy_unavailable", true);
    }
    throw error;
  }
});

function rateLimit(
  request: Parameters<typeof clientIp>[0],
  store: Parameters<typeof enforceRateLimit>[0],
  actorId: string,
) {
  return enforceRateLimit(
    store,
    `rl:botblocker-control-policy:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
