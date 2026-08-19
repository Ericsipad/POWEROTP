import { toCommissionResponse } from "@powerotp/api/accounting-responses.js";
import { parseBody } from "@powerotp/api/errors.js";
import { ReferralCommissionSettingsInputSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const PUT = apiRoute(async (request) => {
  const { accountingConfig, auth } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const settings = await accountingConfig.setCommissions(
    authenticated.user._id,
    parseBody(ReferralCommissionSettingsInputSchema, await request.json()),
  );
  return NextResponse.json({ commissions: toCommissionResponse(settings) });
});
