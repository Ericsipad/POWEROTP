import { toCustomerBalanceResponse } from "@powerotp/api/balance-service.js";
import { parseBody } from "@powerotp/api/errors.js";
import { AdjustBalanceSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/**
 * Admin-only manual balance credit/debit — the only way to adjust a
 * customer's balance today outside of the automated charge/top-up paths,
 * e.g. for support cases. See `docs/AS_BUILT.md`'s "Customer signup flow"
 * section (the balance-blocking gap this closes) and "Customer balance
 * billing" section (the ledger this writes into).
 */
export const POST = apiRoute(async (request) => {
  const { auth, balances } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(AdjustBalanceSchema, await request.json());
  await balances.applyLedgerEntry({
    userId: input.userId,
    type: "admin_adjustment",
    amountUsd: input.amountUsd,
    note: input.note,
  });

  const balance = await balances.getBalance(input.userId);
  const response = NextResponse.json({ balance: toCustomerBalanceResponse(balance) });
  response.headers.set("cache-control", "no-store");
  return response;
});
