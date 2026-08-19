import { toThresholdResponse } from "@powerotp/api/accounting-responses.js";
import { parseBody } from "@powerotp/api/errors.js";
import { BillingThresholdRuleInputSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const POST = apiRoute(async (request) => {
  const { accountingConfig, auth } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const threshold = await accountingConfig.createThreshold(
    authenticated.user._id,
    parseBody(BillingThresholdRuleInputSchema, await request.json()),
  );
  return NextResponse.json({ threshold: toThresholdResponse(threshold) }, { status: 201 });
});
