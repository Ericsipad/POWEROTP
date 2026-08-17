import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  identifyBlacklistEntryFamily,
  IpBlacklistValidationError,
  toIpBlacklistEntryResponse,
} from "@powerotp/api/botblocker-ip-blacklist-persistence.js";
import {
  BotBlockerIpFamilySchema,
  OperatorIpBlacklistListResponseSchema,
  OperatorIpBlacklistMutationResponseSchema,
  OperatorIpBlacklistMutationSchema,
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
  const { auth, botBlockerIpBlacklist, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);

  const family = BotBlockerIpFamilySchema.safeParse(
    request.nextUrl.searchParams.get("family"),
  );
  if (!family.success) return botBlockerError("invalid_request", 400);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  if (limit === undefined) return botBlockerError("invalid_request", 400);
  const cursor = request.nextUrl.searchParams.get("cursor");
  const before = cursor ? new Date(cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return botBlockerError("invalid_request", 400);
  }

  const entries = await botBlockerIpBlacklist.listEntries(family.data, {
    limit,
    before,
  });
  const response = NextResponse.json(
    OperatorIpBlacklistListResponseSchema.parse({
      entries: entries.map((entry) =>
        toIpBlacklistEntryResponse(entry, family.data)
      ),
      nextCursor:
        entries.length === limit
          ? entries.at(-1)?.createdAt.toISOString()
          : undefined,
    }),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, botBlockerIpBlacklist, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await rateLimit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorIpBlacklistMutationSchema,
    await request.json(),
  );
  try {
    const entry = await botBlockerIpBlacklist.upsertEntry({
      ip: input.ip,
      reason: input.reason,
      provenance: input.provenance,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      createdBy: authenticated.user._id,
      now: new Date(),
    });
    const family = identifyBlacklistEntryFamily(entry._id);
    if (!family) return botBlockerError("invalid_request", 400);
    const response = NextResponse.json(
      OperatorIpBlacklistMutationResponseSchema.parse({
        entry: toIpBlacklistEntryResponse(entry, family),
      }),
      { status: 201 },
    );
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof IpBlacklistValidationError) {
      return botBlockerError("invalid_request", 400);
    }
    throw error;
  }
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
    `rl:botblocker-control-ip-blacklist:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
