import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession } from "@/lib/session-cookies";

/**
 * Read-only admin visibility into BullMQ job counts — see
 * `apps/api/src/verification-queue.ts#getQueueCounts` and
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section. Nothing
 * to configure or clear here; this is purely a snapshot for spotting a
 * stuck/backed-up queue without a direct Valkey connection.
 */
export const GET = apiRoute(async (request) => {
  const { auth, queues } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({ queues: await queues.getQueueCounts() });
  response.headers.set("cache-control", "no-store");
  return response;
});
