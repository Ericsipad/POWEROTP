import { parseBody } from "@powerotp/api/errors.js";
import { CustomerLoginSchema } from "@powerotp/contracts";
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
    `rl:login:${clientIp(request) ?? "unknown"}`,
    8,
    5 * 60,
  );

  const session = await auth.loginCustomer(parseBody(CustomerLoginSchema, await request.json()));
  const response = NextResponse.json({
    user: sessionUser(session.user),
    csrfToken: session.csrfToken,
  });
  setSessionCookies(response, session.sessionToken, session.csrfToken, session.expiresAt);
  return response;
});
