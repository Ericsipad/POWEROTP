import { parseBody } from "@powerotp/api/errors.js";
import { UpsertCallRateCardSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/**
 * Admin-editable per-country call rate chart (USD/minute, per tier) — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. The actual
 * numbers are gathered by an admin from VoIP.ms's own published per-minute
 * rates and entered here; never fetched automatically.
 */
export const GET = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ rates: await rateCharts.listCallRates() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const PUT = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(UpsertCallRateCardSchema, await request.json());
  const rate = await rateCharts.upsertCallRate(input);
  const response = NextResponse.json({ rate });
  response.headers.set("cache-control", "no-store");
  return response;
});
