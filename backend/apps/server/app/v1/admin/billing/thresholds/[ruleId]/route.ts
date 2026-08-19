import { toThresholdResponse } from "@powerotp/api/accounting-responses.js";
import { parseBody } from "@powerotp/api/errors.js";
import { UpdateBillingThresholdRuleSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ ruleId: string }>;
}

export const PATCH = apiRoute<RouteParams>(async (request, { params }) => {
  const { accountingConfig, auth } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const { ruleId } = await params;
  const threshold = await accountingConfig.updateThreshold(
    authenticated.user._id,
    ruleId,
    parseBody(UpdateBillingThresholdRuleSchema, await request.json()),
  );
  return NextResponse.json({ threshold: toThresholdResponse(threshold) });
});
