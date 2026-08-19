import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { authenticateProjectApiKey } from "@powerotp/api/project-api-auth.js";
import { ProjectAuthSessionReportSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { config, dataStores, projectAuthSessions } = await getServerContext();
  const { projectId: slug } = await params;
  const project = await authenticateProjectApiKey(
    dataStores.db,
    config,
    slug,
    request.headers.get("authorization") ?? undefined,
  );
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:project-auth-sessions:${project._id}:${clientIp(request) ?? "unknown"}`,
    120,
    60,
  );
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new ApiError("idempotency_key_required", 400);
  }
  const result = await projectAuthSessions.report(
    project._id,
    project.customerId,
    idempotencyKey,
    parseBody(ProjectAuthSessionReportSchema, await request.json()),
  );
  const response = NextResponse.json(
    {
      sessionId: result.document._id,
      replayed: result.replayed,
      reportedAt: result.document.reportedAt.toISOString(),
    },
    { status: result.replayed ? 200 : 201 },
  );
  response.headers.set("cache-control", "no-store");
  return response;
});
