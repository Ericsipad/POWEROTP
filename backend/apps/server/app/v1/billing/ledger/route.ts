import { toFinancialTransactionResponse } from "@powerotp/api/billing-responses.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

/** A customer's own recent ledger rows, newest first — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. */
export const GET = apiRoute(async (request) => {
  const { auth, balances } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const transactions = await balances.listLedger(authenticated.user._id);
  const response = NextResponse.json({ transactions: transactions.map(toFinancialTransactionResponse) });
  response.headers.set("cache-control", "no-store");
  return response;
});
