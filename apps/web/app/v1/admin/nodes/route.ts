import { parseBody } from "@powerotp/api/errors.js";
import { CreateNodeSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const GET = apiRoute(async (request) => {
  const { auth, nodes } = await getServerContext();
  await requireAdminSession(request, auth);

  const response = NextResponse.json({ nodes: await nodes.list() });
  response.headers.set("cache-control", "no-store");
  return response;
});

/**
 * Issues a new node identity: a hashed-at-rest bearer secret returned
 * exactly once, the same convention as project API keys. The operator
 * copies it onto the droplet's protected agent env file.
 */
export const POST = apiRoute(async (request) => {
  const { auth, nodes } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const input = parseBody(CreateNodeSchema, await request.json());
  const enrolled = await nodes.enroll(authenticated.user._id, input);

  const response = NextResponse.json(enrolled, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
