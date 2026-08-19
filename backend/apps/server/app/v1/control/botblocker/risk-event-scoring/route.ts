import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  OperatorRiskEventScoringConfigurationMutationResponseSchema,
  OperatorRiskEventScoringConfigurationMutationSchema,
  OperatorRiskEventScoringConfigurationResponseSchema,
  riskEventScoreableFields,
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
    botBlockerRiskEventScoringConfiguration,
    dataStores,
  } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  const stored =
    await botBlockerRiskEventScoringConfiguration.getConfiguration();
  const response = NextResponse.json(
    OperatorRiskEventScoringConfigurationResponseSchema.parse(
      stored
        ? {
          status: "configured",
          registry: riskEventScoreableFields,
          configuration: stored.configuration,
          updatedBy: stored.updatedBy,
          updatedAt: stored.updatedAt.toISOString(),
        }
        : {
          status: "unconfigured",
          registry: riskEventScoreableFields,
        },
    ),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const {
    auth,
    botBlockerRiskEventScoringConfiguration,
    dataStores,
  } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorRiskEventScoringConfigurationMutationSchema,
    await request.json(),
  );
  const stored =
    await botBlockerRiskEventScoringConfiguration.replaceConfiguration({
      configuration: input.configuration,
      updatedBy: authenticated.user._id,
      now: new Date(),
    });
  const response = NextResponse.json(
    OperatorRiskEventScoringConfigurationMutationResponseSchema.parse({
      status: "configured",
      registry: riskEventScoreableFields,
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
    `rl:botblocker-control-risk-event-scoring:${actorId}:${
      clientIp(request) ?? "unknown"
    }`,
    60,
    60,
  );
}
