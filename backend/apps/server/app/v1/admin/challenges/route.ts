import { parseBody } from "@powerotp/api/errors.js";
import { CreateChallengeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, challenges } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ challenges: await challenges.listChallenges() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, challenges } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(CreateChallengeSchema, await request.json());
  const challenge = await challenges.createChallenge(input, authenticated.user._id);
  const response = NextResponse.json({ challenge }, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
