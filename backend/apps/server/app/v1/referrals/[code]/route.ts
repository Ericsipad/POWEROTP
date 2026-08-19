import { ReferralCodeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { code: rawCode } = await params;
  const parsed = ReferralCodeSchema.safeParse(rawCode);
  const { dataStores, referrals } = await getServerContext();
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:referral-lookup:${clientIp(request) ?? "unknown"}`,
    30,
    60,
  );
  const valid = parsed.success && Boolean(await referrals.resolve(parsed.data));
  const response = NextResponse.json({ valid });
  response.headers.set("cache-control", "no-store");
  return response;
});
