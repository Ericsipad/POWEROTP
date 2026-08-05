import { parseBody } from "@powerotp/api/errors.js";
import { CustomerRegistrationSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import { sessionUser } from "@/lib/session-cookies";

export const POST = apiRoute(async (request) => {
  const { auth, dataStores } = await getServerContext();
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:admin-bootstrap:${clientIp(request) ?? "unknown"}`,
    3,
    60 * 60,
  );

  const result = await auth.bootstrapAdmin(
    parseBody(CustomerRegistrationSchema, await request.json()),
    request.headers.get("x-admin-bootstrap-token") ?? "",
  );
  return NextResponse.json(
    { user: sessionUser(result.user), totpUri: result.totpUri },
    { status: 201 },
  );
});
