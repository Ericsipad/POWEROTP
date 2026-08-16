import { ApiError } from "@powerotp/api/errors.js";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-route";
import { getServerContext } from "@/lib/server-context";
import { requireAdminSession, verifyCsrfHeader } from "@/lib/session-cookies";

/**
 * Admin-only recording catalog for `voice_challenge` (Type 3). Uploads are
 * validated and normalized in-process (see
 * `backend/packages/api/src/media-service.ts`) then written to private Spaces —
 * customers never author or select recordings (`docs/PRODUCT_SPEC.md`:
 * "POWEROTP selects the immutable recording/challenge version").
 */
export const GET = apiRoute(async (request) => {
  const { auth, challenges } = await getServerContext();
  await requireAdminSession(request, auth);
  const response = NextResponse.json({ recordings: await challenges.listRecordings() });
  response.headers.set("cache-control", "no-store");
  return response;
});

export const POST = apiRoute(async (request) => {
  const { auth, challenges } = await getServerContext();
  const authenticated = await requireAdminSession(request, auth);
  verifyCsrfHeader(request, auth, authenticated.session);

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new ApiError("recording_file_required", 400);

  const recording = await challenges.publishRecording(
    Buffer.from(await file.arrayBuffer()),
    authenticated.user._id,
  );
  const response = NextResponse.json({ recording }, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
