import { toAdSystemResponse } from "@powerotp/api/accounting-responses.js";
import { parseBody } from "@powerotp/api/errors.js";
import { UpsertAdSystemSchema } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

export const PUT = apiRoute(async (request) => {
  const { accountingConfig, auth } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);
  const system = await accountingConfig.upsertAdSystem(
    authenticated.user._id,
    parseBody(UpsertAdSystemSchema, await request.json()),
  );
  return NextResponse.json({ adSystem: toAdSystemResponse(system) });
});
