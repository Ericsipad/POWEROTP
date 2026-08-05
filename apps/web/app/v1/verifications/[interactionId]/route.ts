import { ApiError } from "@powerotp/api/errors.js";
import { authenticateApiKey } from "@powerotp/api/project-api-auth.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, verifications } = await getServerContext();
  const { interactionId } = await params;

  const project = await authenticateApiKey(
    dataStores.db,
    config,
    request.headers.get("authorization") ?? undefined,
  );
  const verification = await verifications.get(interactionId);
  if (!verification || verification.projectId !== project._id) {
    throw new ApiError("verification_not_found", 404);
  }

  const response = NextResponse.json(verifications.toStatus(verification));
  response.headers.set("cache-control", "no-store");
  return response;
});
