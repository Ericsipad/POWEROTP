import { ApiError, parseBody } from "@powerotp/api/errors.js";
import { NodeJobEventSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ interactionId: string }>;
}

/**
 * Node-facing progress/result report for a job it previously claimed from
 * `/v1/nodes/jobs/next`. Reuses the same `VerificationService.transition`
 * every other transport drives, so a node gets exactly the same durable
 * event/callback machinery as the rest of the app — it just supplies the
 * `state` from its own call progress instead of a code/challenge answer.
 * `NodeJobEventSchema` restricts `state` to values a node is allowed to
 * report; the control plane alone ever sets `queued`/`dispatching`/`calling`.
 */
export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { verifications, nodes } = await getServerContext();
  await nodes.authenticate(request.headers.get("authorization") ?? undefined, clientIp(request));
  const { interactionId } = await params;

  const { state, reasonCode, trunkId } = parseBody(NodeJobEventSchema, await request.json());
  if (trunkId) {
    await verifications.recordProviderAttemptMeta(interactionId, { callTrunkId: trunkId });
  }
  const applied = await verifications.transition(interactionId, state, reasonCode);
  if (!applied) throw new ApiError("stale_verification_state", 409);

  const response = NextResponse.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  return response;
});
