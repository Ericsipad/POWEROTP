import { toFinancialTransactionResponse } from "@powerotp/api/billing-responses.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession } from "@/lib/session-cookies";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, balances, projectAuthSessions, projects, referrals } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  const { projectId } = await params;
  await projects.assertOwned(authenticated.user._id, projectId);
  const [summary, attribution, transactions] = await Promise.all([
    projectAuthSessions.summary(projectId),
    referrals.getProjectAttribution(projectId),
    balances.listProjectLedger(authenticated.user._id, projectId),
  ]);
  const response = NextResponse.json({
    ...summary,
    referralCode: attribution?.referralCode,
    transactions: transactions.map(toFinancialTransactionResponse),
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
