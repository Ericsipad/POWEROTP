import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { OperatorRapidListMutationSchema } from "@powerotp/contracts";

import { apiRoute, clientIp } from "@/lib/api-route";
import { botBlockerUnavailable } from "@/lib/botblocker-http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import {
  requireAdminSession,
  verifyCsrfHeader,
} from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  await limit(request, dataStores.rateLimitStore, authenticated.user._id);
  return botBlockerUnavailable("not_implemented", false);
});

export const POST = apiRoute(async (request) => {
  const { auth, dataStores } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  await limit(request, dataStores.rateLimitStore, authenticated.user._id);
  if (!request.headers.get("idempotency-key")) {
    throw new ApiError("idempotency_key_required", 400);
  }
  parseBody(OperatorRapidListMutationSchema, await request.json());
  return botBlockerUnavailable("not_implemented", false);
});

function limit(
  request: Parameters<typeof clientIp>[0],
  store: Parameters<typeof enforceRateLimit>[0],
  actorId: string,
) {
  return enforceRateLimit(
    store,
    `rl:botblocker-control-rapid-list:${actorId}:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
}
