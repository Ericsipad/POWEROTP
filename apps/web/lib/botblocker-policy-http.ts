import type { BotBlockerPolicyFetchResult } from "@powerotp/api/botblocker-policy-service.js";
import type {
  BotBlockerErrorResponse,
  BotBlockerUnavailableResponse,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { ifNoneMatchMatches } from "./http-etag";

const POLICY_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export function botBlockerPolicyHttpResponse(
  ifNoneMatch: string | null,
  result: BotBlockerPolicyFetchResult,
): NextResponse {
  if (result.status === "unknown_site") {
    const body = {
      status: "error",
      code: "unknown_site",
      message: "The BotBlocker site does not exist",
    } satisfies BotBlockerErrorResponse;
    return NextResponse.json(body, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  if (result.status === "unavailable") {
    const body = {
      status: "unavailable",
      reason: "policy_unavailable",
      message: "No valid active policy release is available",
      retryable: true,
    } satisfies BotBlockerUnavailableResponse;
    return NextResponse.json(body, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const headers = {
    "cache-control": POLICY_CACHE_CONTROL,
    etag: result.etag,
  };
  if (ifNoneMatchMatches(ifNoneMatch, result.etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(result.response, { headers });
}
