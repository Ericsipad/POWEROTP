import { parseBody } from "@powerotp/api/errors.js";
import { UpsertEmailRateSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/** Admin-editable flat `email_code` rate (USD/email, per tier) — a single
 * global rate, not per-country (see `EmailRateSchema`'s doc comment in
 * `backend/packages/contracts/src/billing.ts`). */
export const GET = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ rate: await rateCharts.getEmailRate() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const PUT = apiRoute(async (request) => {
  const { auth, rateCharts } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(UpsertEmailRateSchema, await request.json());
  const rate = await rateCharts.upsertEmailRate(input);
  const response = NextResponse.json({ rate });
  response.headers.set("cache-control", "no-store");
  return response;
});
