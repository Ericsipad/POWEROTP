import { ApiError } from "@powerotp/api/errors.js";
import { AuthError } from "@powerotp/api/auth-service.js";
import { NodeError } from "@powerotp/api/node-service.js";
import { ProjectError } from "@powerotp/api/project-service.js";
import { VerificationError } from "@powerotp/api/verification-service.js";
import { InteractionTokenError } from "@powerotp/api/interaction-tokens.js";
import { NextResponse } from "next/server";

/**
 * Every route handler throws one of these typed errors instead of
 * constructing its own error response, so status/code mapping stays in
 * one place — the same role Fastify's global error handler used to play.
 */
export function toErrorResponse(error: unknown, correlationId: string): NextResponse {
  if (
    error instanceof ApiError ||
    error instanceof AuthError ||
    error instanceof NodeError ||
    error instanceof ProjectError ||
    error instanceof VerificationError ||
    error instanceof InteractionTokenError
  ) {
    return NextResponse.json(
      { error: error.code },
      { status: error.statusCode, headers: { "x-correlation-id": correlationId } },
    );
  }

  console.error(
    JSON.stringify({
      service: "powerotp",
      correlationId,
      msg: "request failed",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return NextResponse.json(
    { error: "internal_error" },
    { status: 500, headers: { "x-correlation-id": correlationId } },
  );
}
