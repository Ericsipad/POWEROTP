import { parseBody } from "@powerotp/api/errors.js";
import { UpdatePlanChargeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/** Admin-editable per-tier monthly-display/daily-charged plan fee — both
 * values are independently entered, never one derived from the other. See
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. */
export const GET = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ plans: await rateCharts.listPlanCharges() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const PUT = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(UpdatePlanChargeSchema, await request.json());
  const plan = await rateCharts.updatePlanCharge(input);
  const response = NextResponse.json({ plan });
  response.headers.set("cache-control", "no-store");
  return response;
});
