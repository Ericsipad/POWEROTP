import { ApiError } from "@powerotp/api/errors.js";
import { createId } from "@powerotp/api/security.js";
import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "./api-errors";

/**
 * Wraps a route handler with the two cross-cutting concerns every
 * endpoint needs: a correlation ID (generated fresh per request and
 * echoed on every response, matching the MVP acceptance requirement that
 * "every external request receives a correlation ID") and centralized
 * error-to-status mapping.
 */
export function apiRoute<Context = unknown>(
  handler: (request: NextRequest, context: Context, correlationId: string) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context: Context): Promise<NextResponse> => {
    const correlationId = createId("req");
    try {
      const response = await handler(request, context, correlationId);
      response.headers.set("x-correlation-id", correlationId);
      return response;
    } catch (error) {
      return toErrorResponse(error, correlationId);
    }
  };
}

export function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim();
}

export function requireAllowedOrigin(request: NextRequest, publicAppUrl: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(publicAppUrl).origin) {
    throw new ApiError("origin_not_allowed", 403);
  }
}
