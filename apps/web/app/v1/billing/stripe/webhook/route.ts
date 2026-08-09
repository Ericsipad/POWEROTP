import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Public Stripe webhook endpoint — no session, authenticated entirely by
 * Stripe's own request signature (`stripe-signature` header) verified
 * against `STRIPE_WEBHOOK_SECRET`. Reads the raw request body as text
 * (never `request.json()` first) since signature verification requires the
 * exact bytes Stripe signed. See `docs/AS_BUILT.md`'s "Customer balance
 * billing" section and `apps/api/src/stripe-service.ts`.
 */
export const POST = apiRoute(async (request) => {
  const { stripeTopups } = await getServerContext();
  const rawBody = await request.text();
  await stripeTopups.handleWebhookEvent(rawBody, request.headers.get("stripe-signature") ?? undefined);

  const response = NextResponse.json({ received: true });
  response.headers.set("cache-control", "no-store");
  return response;
});
