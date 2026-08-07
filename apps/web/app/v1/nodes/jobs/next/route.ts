import { ApiError } from "@powerotp/api/errors.js";
import { VerificationTypeSchema, type NodeJob } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Node-facing job queue: a droplet polls this (fast, independent of the
 * slower `/v1/nodes/config` trunk-sync poll) to claim the next interaction
 * of a type it has a registered trunk for. `204` means nothing is
 * currently waiting. See `apps/api/src/verification-service.ts#claimNextForNode`
 * for the atomic claim and `apps/telephony-agent/src/job-poller.ts` for the
 * consumer.
 */
export const GET = apiRoute(async (request) => {
  const { verifications, nodes } = await getServerContext();
  await nodes.authenticate(request.headers.get("authorization") ?? undefined, clientIp(request));

  const typeParam = new URL(request.url).searchParams.get("type");
  const parsedType = VerificationTypeSchema.safeParse(typeParam);
  if (!parsedType.success) throw new ApiError("invalid_request", 400);

  const claimed = await verifications.claimNextForNode(parsedType.data);
  if (!claimed) {
    return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  const job: NodeJob = {
    interactionId: claimed._id,
    type: claimed.type,
    targetNumber: claimed.targetNumber,
    code: claimed.type === "voice_code" ? verifications.codeForDelivery(claimed) : undefined,
  };
  const response = NextResponse.json(job);
  response.headers.set("cache-control", "no-store");
  return response;
});
