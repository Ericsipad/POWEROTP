import { parseBody } from "@powerotp/api/errors.js";
import { UpsertSmsRateCardSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/** Admin-editable per-country SMS rate chart (USD/message, per tier) — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. */
export const GET = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ rates: await rateCharts.listSmsRates() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const PUT = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(UpsertSmsRateCardSchema, await request.json());
  const rate = await rateCharts.upsertSmsRate(input);
  const response = NextResponse.json({ rate });
  response.headers.set("cache-control", "no-store");
  return response;
});
