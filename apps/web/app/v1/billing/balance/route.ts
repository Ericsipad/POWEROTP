import { toCustomerBalanceResponse } from "@powerotp/api/balance-service.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

/** A customer's own current balance/tier — see `docs/AS_BUILT.md`'s
 * "Customer balance billing" section. */
export const GET = apiRoute(async (request) => {
  const { auth, balances } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const balance = await balances.getBalance(authenticated.user._id);
  const response = NextResponse.json({ balance: toCustomerBalanceResponse(balance) });
  response.headers.set("cache-control", "no-store");
  return response;
});
