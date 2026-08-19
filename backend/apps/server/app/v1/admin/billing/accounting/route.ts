import {
  toAdPayoutResponse,
  toAdSystemResponse,
  toCommissionResponse,
  toThresholdResponse,
} from "@powerotp/api/accounting-responses.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { accountingConfig, auth } = await getServerContext();
  await requireAdminSession(request, auth);
  const config = await accountingConfig.list();
  const response = NextResponse.json({
    adSystems: config.adSystems.map(toAdSystemResponse),
    thresholds: config.thresholds.map(toThresholdResponse),
    commissions: toCommissionResponse(config.commissions),
    payouts: config.payouts.map(toAdPayoutResponse),
    serviceDates: config.serviceDates,
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
