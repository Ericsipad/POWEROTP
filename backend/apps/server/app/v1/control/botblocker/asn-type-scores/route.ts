import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  toAsnTypeScoreResponse,
  type AsnTypeScoreDocument,
} from "@powerotp/api/botblocker-asn-type-score-persistence.js";
import {
  OperatorAsnTypeScoreListResponseSchema,
  OperatorAsnTypeScoreMutationResponseSchema,
  OperatorAsnTypeScoreMutationSchema,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireAdminSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

/**
 * `botblockerAsnTypeScores` admin page: "a number entry for each ASN
 * type that will dynamically adjust scoring." Always exactly one entry
 * per `AsnTypeSchema` member (`GET` synthesizes an unpersisted
 * `{ score: 0, requiresApiLookup: false }` default for any type not yet
 * configured), so there is no pagination and no per-type sub-resource —
 * `POST` upserts a single type's score in place.
 */
export const GET = apiRoute(async (request) => {
  const { auth, botBlockerAsnTypeScores, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);

  const scores = await botBlockerAsnTypeScores.listAllScores();
  const response = NextResponse.json(
    OperatorAsnTypeScoreListResponseSchema.parse({
      typeScores: scores.map(
        ({ document, persisted }: { document: AsnTypeScoreDocument; persisted: boolean }) =>
          toAsnTypeScoreResponse(document, persisted),
      ),
    }),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, botBlockerAsnTypeScores, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(OperatorAsnTypeScoreMutationSchema, await request.json());
  const typeScore = await botBlockerAsnTypeScores.upsertScore({
    asnType: input.asnType,
    score: input.score,
    requiresApiLookup: input.requiresApiLookup,
    updatedBy: authenticated.user._id,
    now: new Date(),
  });
  const response = NextResponse.json(
    OperatorAsnTypeScoreMutationResponseSchema.parse({
      typeScore: toAsnTypeScoreResponse(typeScore, true),
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
    `rl:botblocker-control-asn-type-scores:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
