import { parseBody } from "@powerotp/api/errors.js";
import { CreateTopupSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

/** Creates a Stripe Checkout session for a fixed-amount ($5/$25/$50/$100)
 * balance top-up — see `docs/AS_BUILT.md`'s "Customer balance billing"
 * section. The actual credit is applied only once Stripe's webhook
 * confirms payment (`POST /v1/billing/stripe/webhook`), never here. */
export const POST = apiRoute(async (request) => {
  const { auth, stripeTopups } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(CreateTopupSchema, await request.json());
  const checkoutUrl = await stripeTopups.createTopupCheckoutSession(
    authenticated.user._id,
    input.amountUsd,
  );
  const response = NextResponse.json({ checkoutUrl });
  response.headers.set("cache-control", "no-store");
  return response;
});
