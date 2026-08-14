import type {
  BotBlockerErrorCode,
  BotBlockerErrorResponse,
  BotBlockerUnavailableReason,
  BotBlockerUnavailableResponse,
} from "@powerotp/contracts";
import { NextResponse } from "next/server";

export function botBlockerUnavailable(
  reason: BotBlockerUnavailableReason,
  retryable: boolean,
  status = 503,
) {
  const body = {
    status: "unavailable",
    reason,
    retryable,
  } satisfies BotBlockerUnavailableResponse;
  return noStore(body, status);
}

export function botBlockerError(
  code: BotBlockerErrorCode,
  status: number,
) {
  const body = { status: "error", code } satisfies BotBlockerErrorResponse;
  return noStore(body, status);
}

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
