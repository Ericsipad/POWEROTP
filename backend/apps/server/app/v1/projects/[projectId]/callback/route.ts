import { parseBody } from "@powerotp/api/errors.js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiRoute, clientIp } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireCustomerSession, verifyCsrfHeader } from "@/lib/session-cookies";

const CallbackSchema = z.object({
  callbackUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", "HTTPS is required"),
});

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const POST = apiRoute<RouteParams>(async (request, { params }) => {
  const { auth, projects } = await getServerContext();
  const authenticated = await requireCustomerSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const { projectId } = await params;
  const { callbackUrl } = parseBody(CallbackSchema, await request.json());
  const value = await projects.rotateCallback(
    authenticated.user._id,
    projectId,
    callbackUrl,
    clientIp(request),
  );
  const response = NextResponse.json({ value });
  response.headers.set("cache-control", "no-store");
  return response;
});
