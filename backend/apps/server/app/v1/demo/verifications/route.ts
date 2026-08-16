import { parseBody } from "@powerotp/api/errors.js";
import { demoVerificationStatusUrl } from "@powerotp/api/public-urls.js";
import { DemoVerificationRequestSchema, type VerificationAccepted } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { requireDemoProject } from "@/lib/demo-project";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

/**
 * Public, anonymous "try it now" widget on the marketing site. Scoped to
 * exactly one operator-configured demo project (never an arbitrary
 * customer project) and never accepts or returns a project API key.
 * Disabled entirely (404) when `DEMO_PROJECT_SLUG` is unset.
 */
export const POST = apiRoute(async (request, _context, correlationId) => {
  const context = await getServerContext();
  await enforceRateLimit(
    context.dataStores.rateLimitStore,
    `rl:demo-create:${clientIp(request) ?? "unknown"}`,
    5,
    60,
  );
  const project = await requireDemoProject(context);
  const input = parseBody(DemoVerificationRequestSchema, await request.json());

  const accepted = await context.verifications.create(
    project._id,
    project.customerId,
    { ...input, browserResponse: false },
    crypto.randomUUID(),
    correlationId,
  );

  const body: VerificationAccepted = {
    interactionId: accepted.interactionId,
    state: "queued",
    statusUrl: demoVerificationStatusUrl(
      context.config.PUBLIC_API_URL,
      accepted.interactionId,
    ),
    expiresAt: accepted.expiresAt,
  };
  const response = NextResponse.json(body, { status: 202 });
  response.headers.set("cache-control", "no-store");
  return response;
});
