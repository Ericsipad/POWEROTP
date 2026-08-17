import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  toAsnClassificationResponse,
} from "@powerotp/api/botblocker-asn-classification-persistence.js";
import {
  AsnTypeSchema,
  OperatorAsnClassificationListResponseSchema,
  OperatorAsnClassificationMutationResponseSchema,
  OperatorAsnClassificationMutationSchema,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { botBlockerError } from "@/lib/botblocker-http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireAdminSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

const MAX_LIMIT = 200;

export const GET = apiRoute(async (request) => {
  const { auth, botBlockerAsnClassifications, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);

  const asnTypeParam = request.nextUrl.searchParams.get("asnType");
  const asnType = asnTypeParam ? AsnTypeSchema.safeParse(asnTypeParam) : undefined;
  if (asnType && !asnType.success) return botBlockerError("invalid_request", 400);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  if (limit === undefined) return botBlockerError("invalid_request", 400);
  const cursor = request.nextUrl.searchParams.get("cursor");
  const before = cursor ? new Date(cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return botBlockerError("invalid_request", 400);
  }

  const classifications = await botBlockerAsnClassifications.listClassifications({
    asnType: asnType?.data,
    limit,
    before,
  });
  const response = NextResponse.json(
    OperatorAsnClassificationListResponseSchema.parse({
      classifications: classifications.map(toAsnClassificationResponse),
      nextCursor:
        classifications.length === limit
          ? classifications.at(-1)?.updatedAt.toISOString()
          : undefined,
    }),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, botBlockerAsnClassifications, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorAsnClassificationMutationSchema,
    await request.json(),
  );
  const classification = await botBlockerAsnClassifications.upsertClassification({
    asn: input.asn,
    asnType: input.asnType,
    classificationSource: input.classificationSource,
    asnOrg: input.asnOrg,
    notes: input.notes,
    updatedBy: authenticated.user._id,
    now: new Date(),
  });
  const response = NextResponse.json(
    OperatorAsnClassificationMutationResponseSchema.parse({
      classification: toAsnClassificationResponse(classification),
    }),
    { status: 201 },
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

function parseLimit(value: string | null): number | undefined {
  if (!value) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return undefined;
  }
  return limit;
}

function rateLimit(
  request: Parameters<typeof clientIp>[0],
  store: Parameters<typeof enforceRateLimit>[0],
  actorId: string,
) {
  return enforceRateLimit(
    store,
    `rl:botblocker-control-asn-classifications:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
