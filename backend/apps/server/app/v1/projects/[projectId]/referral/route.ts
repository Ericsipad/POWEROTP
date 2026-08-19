import { parseBody } from "@powerotp/api/errors.js";
import { SetProjectReferralSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const PUT = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, referrals } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const { projectId } = await params;
  const input = parseBody(SetProjectReferralSchema, await request.json());
  const attribution = await referrals.setProjectAttribution(
    authenticated.user._id,
    projectId,
    input.code,
  );
  return NextResponse.json({ referralCode: attribution?.referralCode ?? null });
});
