import { ApiError, parseBody } from "@powerotp/api/errors.js";
import {
  identifyBlacklistEntryFamily,
  toIpBlacklistEntryResponse,
} from "@powerotp/api/botblocker-ip-blacklist-persistence.js";
import {
  OperatorIpBlacklistMutationResponseSchema,
  OperatorIpBlacklistRevokeRequestSchema,
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

export const POST = apiRoute(async (request) => {
  const { auth, botBlockerIpBlacklist, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:botblocker-control-ip-blacklist-revoke:${authenticated.user._id}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const input = parseBody(
    OperatorIpBlacklistRevokeRequestSchema,
    await request.json(),
  );
  const family = identifyBlacklistEntryFamily(input.entryId);
  if (!family) return botBlockerError("unknown_entry", 404);
  const entry = await botBlockerIpBlacklist.revokeEntry(
    input.entryId,
    new Date(),
  );
  if (!entry) return botBlockerError("unknown_entry", 404);
  const response = NextResponse.json(
    OperatorIpBlacklistMutationResponseSchema.parse({
      entry: toIpBlacklistEntryResponse(entry, family),
    }),
  );
  response.headers.set("cache-control", "no-store");
  return response;
});
