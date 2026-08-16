import { recordBotSignal } from "@powerotp/api/bot-signal-service.js";
import { NextResponse } from "next/server";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * The backing endpoint for the hidden "Website AI index summary" honeypot
 * link on the hosted verification modal (see
 * `frontend/app/widget/[sessionId]/page.tsx` and `docs/AS_BUILT.md`'s
 * "Hosted verification modal" section) — visually hidden from real human
 * visitors, so anything that requests this is treated as a "possible bot"
 * signal, not a real feature request. Deliberately no rate limiting here:
 * throttling a honeypot would just teach an automated scraper to slow
 * down, and every request is already a signal worth recording regardless
 * of frequency. Never fails the request over a logging error — a broken
 * signal pipeline must not become a visible bug for whatever fetched this.
 */
export const GET = apiRoute<RouteParams>(async (request, { params }) => {
  const { dataStores, modalSessions } = await getServerContext();
  const { sessionId } = await params;

  const session = await modalSessions.get(sessionId).catch(() => undefined);

  await recordBotSignal(dataStores.db, {
    projectId: session?.projectId,
    sessionId,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  }).catch(() => undefined);

  const response = NextResponse.json({
    summary: "coming_soon",
  });
  response.headers.set("cache-control", "no-store");
  return response;
});
