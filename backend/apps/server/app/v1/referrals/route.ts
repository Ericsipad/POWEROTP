import { parseBody } from "@powerotp/api/errors.js";
import { CreateReferralCodeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, referrals } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const referral = await referrals.getOwnedCode(authenticated.user._id);
  return NextResponse.json({ referralCode: referral?._id ?? null });
});

export const POST = apiRoute(async (request) => {
  const { auth, referrals } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const input = parseBody(CreateReferralCodeSchema, await request.json());
  const referral = await referrals.createCode(authenticated.user._id, input.code);
  return NextResponse.json({ referralCode: referral._id }, { status: 201 });
});
