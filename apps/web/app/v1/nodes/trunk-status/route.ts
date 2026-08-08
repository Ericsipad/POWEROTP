import { parseBody } from "@powerotp/api/errors.js";
import { TrunkStatusReportSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

/**
 * Node-facing, `NODE_SECRET`-authenticated exactly like `/v1/nodes/config` —
 * a droplet self-reports its real SIP registration state (from
 * `apps/telephony-agent/src/pjsip-status.ts`) plus its `TrunkPool`'s own
 * call-outcome health (`trunk-pool.ts#snapshot`) each config-poll cycle, so
 * an admin can see current trunk health without SSH-ing in. Purely
 * informational — never read by any dispatch/rotation logic.
 */
export const POST = apiRoute(async (request) => {
  const { nodes } = await getServerContext();
  await nodes.authenticate(request.headers.get("authorization") ?? undefined, clientIp(request));

  const { trunks } = parseBody(TrunkStatusReportSchema, await request.json());
  await nodes.reportTrunkStatus(clientIp(request) ?? "unknown", trunks);

  const response = NextResponse.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  return response;
});
