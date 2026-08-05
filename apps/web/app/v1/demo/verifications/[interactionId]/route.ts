import { ApiError } from "@powerotp/api/errors.js";
import type { ProjectDocument } from "@powerotp/api/persistence.js";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext, type ServerContext } from "@/lib/server-context";

async function requireDemoProject(context: ServerContext): Promise<ProjectDocument> {
  if (!context.config.DEMO_PROJECT_SLUG) throw new ApiError("demo_not_configured", 404);
  const project = await context.dataStores.db
    .collection<ProjectDocument>("projects")
    .findOne({ slug: context.config.DEMO_PROJECT_SLUG, active: true });
  if (!project) throw new ApiError("demo_not_configured", 404);
  return project;
}

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const context = await getServerContext();
  await enforceRateLimit(
    context.dataStores.rateLimitStore,
    `rl:demo-status:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );
  const project = await requireDemoProject(context);

  const { interactionId } = await params;
  const verification = await context.verifications.get(interactionId);
  if (!verification || verification.projectId !== project._id) {
    throw new ApiError("verification_not_found", 404);
  }

  const response = NextResponse.json(context.verifications.toStatus(verification));
  response.headers.set("cache-control", "no-store");
  return response;
});
