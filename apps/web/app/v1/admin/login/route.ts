import { parseBody } from "@powerotp/api/errors.js";
import { AdminLoginSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp, requireAllowedOrigin } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";
import { sessionUser, setSessionCookies } from "@/lib/session-cookies";

export const POST = apiRoute(async (request) => {
  const { auth, config, dataStores } = await getServerContext();
  requireAllowedOrigin(request, config.PUBLIC_APP_URL);
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:admin-login:${clientIp(request) ?? "unknown"}`,
    5,
    5 * 60,
  );

  const session = await auth.loginAdmin(
    parseBody(AdminLoginSchema, await request.json()),
    clientIp(request),
  );
  const response = NextResponse.json({
    user: sessionUser(session.user),
    csrfToken: session.csrfToken,
  });
  setSessionCookies(response, session.sessionToken, session.csrfToken, session.expiresAt);
  return response;
});
