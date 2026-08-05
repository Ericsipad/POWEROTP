import { ApiError, parseBody } from "@powerotp/api/errors.js";
import type { ProjectDocument } from "@powerotp/api/persistence.js";
import { DemoVerificationRequestSchema, type VerificationAccepted } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext, type ServerContext } from "@/lib/server-context";

/**
 * Public, anonymous "try it now" widget on the marketing site. Scoped to
 * exactly one operator-configured demo project (never an arbitrary
 * customer project) and never accepts or returns a project API key.
 * Disabled entirely (404) when `DEMO_PROJECT_SLUG` is unset.
 */
async function requireDemoProject(context: ServerContext): Promise<ProjectDocument> {
  if (!context.config.DEMO_PROJECT_SLUG) throw new ApiError("demo_not_configured", 404);
  const project = await context.dataStores.db
    .collection<ProjectDocument>("projects")
    .findOne({ slug: context.config.DEMO_PROJECT_SLUG, active: true });
  if (!project) throw new ApiError("demo_not_configured", 404);
  return project;
}

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
    statusUrl: new URL(
      `/v1/demo/verifications/${accepted.interactionId}`,
      context.config.PUBLIC_APP_URL,
    ).toString(),
    expiresAt: accepted.expiresAt,
  };
  const response = NextResponse.json(body, { status: 202 });
  response.headers.set("cache-control", "no-store");
  return response;
});
