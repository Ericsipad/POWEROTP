import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  OperatorProfileScoringConfigurationMutationResponseSchema,
  OperatorProfileScoringConfigurationMutationSchema,
  OperatorProfileScoringConfigurationResponseSchema,
  profileScoreableFields,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireAdminSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const {
    auth,
    botBlockerProfileScoringConfiguration,
    dataStores,
  } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  const stored =
    await botBlockerProfileScoringConfiguration.getConfiguration();
  const response = NextResponse.json(
    OperatorProfileScoringConfigurationResponseSchema.parse(
      stored
        ? {
          status: "configured",
          registry: profileScoreableFields,
          configuration: stored.configuration,
          updatedBy: stored.updatedBy,
          updatedAt: stored.updatedAt.toISOString(),
        }
        : {
          status: "unconfigured",
          registry: profileScoreableFields,
        },
    ),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const {
    auth,
    botBlockerProfileScoringConfiguration,
    dataStores,
  } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorProfileScoringConfigurationMutationSchema,
    await request.json(),
  );
  const stored =
    await botBlockerProfileScoringConfiguration.replaceConfiguration({
      configuration: input.configuration,
      updatedBy: authenticated.user._id,
      now: new Date(),
    });
  const response = NextResponse.json(
    OperatorProfileScoringConfigurationMutationResponseSchema.parse({
      status: "configured",
      registry: profileScoreableFields,
      configuration: stored.configuration,
      updatedBy: stored.updatedBy,
      updatedAt: stored.updatedAt.toISOString(),
    }),
    { status: 201 },
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

function rateLimit(
  request: Parameters<typeof clientIp>[0],
  store: Parameters<typeof enforceRateLimit>[0],
  actorId: string,
) {
  return enforceRateLimit(
    store,
    `rl:botblocker-control-profile-scoring:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
