import { parseBody } from "@powerotp/api/errors.js";
import { issueInteractionToken } from "@powerotp/api/interaction-tokens.js";
import { authenticateProjectApiKey } from "@powerotp/api/project-api-auth.js";
import { ApiError } from "@powerotp/api/errors.js";
import { CreateVerificationSchema, type VerificationAccepted } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

const tokenActionByType = {
  voice_code: "submit_code",
  voice_challenge: "submit_challenge",
} as const;

interface RouteParams {
  /** Despite the folder name, this is the project *slug*, not its internal id. */
  params: Promise<{ projectId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }, correlationId) => {
  const { config, dataStores, verifications } = await getServerContext();
  const { projectId: slug } = await params;

  const project = await authenticateProjectApiKey(
    dataStores.db,
    config,
    slug,
    request.headers.get("authorization") ?? undefined,
  );
  await enforceRateLimit(
    dataStores.rateLimitStore,
    `rl:verifications:${clientIp(request) ?? "unknown"}`,
    60,
    60,
  );

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) throw new ApiError("idempotency_key_required", 400);

  const input = parseBody(CreateVerificationSchema, await request.json());
  if (!project.enabledMethods.includes(input.type)) {
    throw new ApiError("method_not_enabled", 403);
  }

  const accepted = await verifications.create(
    project._id,
    project.customerId,
    input,
    idempotencyKey,
    correlationId,
  );

  const tokenAction =
    input.type === "voice_code" || input.type === "voice_challenge"
      ? tokenActionByType[input.type]
      : undefined;
  const origin = request.headers.get("origin");
  let interactionToken: string | undefined;
  if (input.browserResponse && tokenAction && origin && project.allowedOrigins.includes(origin)) {
    const issued = issueInteractionToken(config.INTERACTION_TOKEN_SECRET, {
      projectId: project._id,
      interactionId: accepted.interactionId,
      action: tokenAction,
      audience: origin,
    });
    await verifications.attachInteractionToken(accepted.interactionId, issued.nonce);
    interactionToken = issued.token;
  }

  const body: VerificationAccepted = {
    interactionId: accepted.interactionId,
    state: "queued",
    statusUrl: accepted.statusUrl,
    expiresAt: accepted.expiresAt,
    interactionToken,
  };
  const response = NextResponse.json(body, { status: 202 });
  response.headers.set("cache-control", "no-store");
  return response;
});
