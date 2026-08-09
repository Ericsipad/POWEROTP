import { toCustomerBalanceResponse, toFinancialTransactionResponse } from "@powerotp/api/balance-service.js";
import { ApiError } from "@powerotp/api/errors.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/** Admin-only: look up any customer's balance/ledger for support — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. Read-only,
 * same manual-lookup convention as every other admin panel. */
export const GET = apiRoute(async (request) => {
  const { auth, balances } = await getServerContext();
  await requireAdminSession(request, auth);

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) throw new ApiError("user_id_required", 400);

  const [balance, transactions] = await Promise.all([
    balances.getBalance(userId),
    balances.listLedger(userId),
  ]);

  const response = NextResponse.json({
    balance: toCustomerBalanceResponse(balance),
    transactions: transactions.map(toFinancialTransactionResponse),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
