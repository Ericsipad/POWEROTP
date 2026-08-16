import { ApiError } from "@powerotp/api/errors.js";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { requireDemoProject } from "@/lib/demo-project";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

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
