import { toAdPayoutResponse } from "@powerotp/api/accounting-responses.js";
import { parseBody } from "@powerotp/api/errors.js";
import { AdDailyPayoutInputSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const PUT = apiRoute(async (request) => {
  const { accountingConfig, auth } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const payout = await accountingConfig.savePayout(
    authenticated.user._id,
    parseBody(AdDailyPayoutInputSchema, await request.json()),
  );
  return NextResponse.json({ payout: toAdPayoutResponse(payout) });
});
