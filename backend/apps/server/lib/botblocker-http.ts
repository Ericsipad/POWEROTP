import { ApiError } from "@powerotp/api/errors.js";
import {
  BotBlockerRuntimeError,
  BotBlockerSiteCredentialError,
} from "@powerotp/api/botblocker-errors.js";
import type { AuthenticatedBotBlockerSite } from "@powerotp/api/botblocker-site-credential-service.js";
import type {
  BotBlockerErrorCode,
  BotBlockerRuntimeRequestEnvelope,
} from "@powerotp/contracts";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { clientIp } from "./api-route";
import {
  botBlockerError,
  botBlockerUnavailable,
} from "./botblocker-responses";
import { enforceRateLimit } from "./rate-limit";
import { getServerContext } from "./server-context";
import type { ServerContext } from "./server-context";

export { botBlockerError, botBlockerUnavailable } from "./botblocker-responses";

export async function unavailableRuntimeMutation<
  T extends BotBlockerRuntimeRequestEnvelope,
>(
  request: NextRequest,
  schema: ZodType<T>,
  operation: string,
  webhookId: string,
  expectedChallengeId?: string,
): Promise<NextResponse> {
  return runtimeMutation(
    request,
    schema,
    operation,
    webhookId,
    undefined,
    expectedChallengeId,
  );
}

/**
 * Every site-credential-authenticated runtime mutation is reached only
 * through its project-scoped `webhookId` URL segment, resolved and checked
 * for existence *before* any body parsing or credential/idempotency work —
 * see `docs/THREAT_MODEL.md`'s "Site-scoped webhook endpoint routing". A
 * `webhookId` that does not resolve to a real site returns a bare 404
 * immediately; it never reaches `BotBlockerRuntimeSecurity`. Once resolved,
 * the existing Bearer site-credential/envelope authentication still runs in
 * full, and the authenticated credential's own site must additionally match
 * the site the URL resolved to — a stolen/reused credential for a different
 * project cannot be replayed against this project's webhook URL.
 */
export async function runtimeMutation<
  T extends BotBlockerRuntimeRequestEnvelope,
>(
  request: NextRequest,
  schema: ZodType<T>,
  operation: string,
  webhookId: string,
  handle?: (
    body: T,
    site: AuthenticatedBotBlockerSite,
    context: ServerContext,
  ) => Promise<void>,
  expectedChallengeId?: string,
): Promise<NextResponse> {
  const context = await getServerContext();
  const { botBlockerSites, botBlockerRuntimeSecurity, dataStores } = context;
  try {
    await enforceRateLimit(
      dataStores.rateLimitStore,
      `rl:botblocker:${operation}:ip:${clientIp(request) ?? "unknown"}`,
      120,
      60,
    );
    const webhookSite = await botBlockerSites.findByWebhookId(webhookId);
    if (!webhookSite) return notFound();

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return botBlockerError("invalid_request", 400);
    const envelope = parsed.data;
    if (
      expectedChallengeId &&
      (!isRecord(envelope.payload) ||
        envelope.payload.challengeId !== expectedChallengeId)
    ) {
      return botBlockerError("invalid_request", 400);
    }

    const site = await botBlockerRuntimeSecurity.authorizeMutation({
      authorizationHeader:
        request.headers.get("authorization") ?? undefined,
      requestOrigin: request.nextUrl.origin,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? undefined,
      operation,
      body: envelope,
      rawBody: body,
    });
    if (site.siteId !== webhookSite._id) {
      return botBlockerError("audience_mismatch", 403);
    }
    await enforceRateLimit(
      dataStores.rateLimitStore,
      `rl:botblocker:${operation}:site:${site.siteId}`,
      600,
      60,
    );
    await handle?.(parsed.data, site, context);
    return botBlockerUnavailable("not_implemented", false);
  } catch (error) {
    return mapBotBlockerRuntimeError(error);
  }
}

export async function unavailableChallengeRead(
  request: NextRequest,
  webhookId: string,
  challengeId: string,
): Promise<NextResponse> {
  const envelope = {
    siteId: request.headers.get("x-botblocker-site-id") ?? "",
    audience: request.headers.get("x-botblocker-audience") ?? "",
    nonce: request.headers.get("x-botblocker-nonce") ?? "",
    issuedAt: Number(request.headers.get("x-botblocker-issued-at")),
  };
  const { botBlockerSites, botBlockerRuntimeSecurity, dataStores } =
    await getServerContext();
  try {
    await enforceRateLimit(
      dataStores.rateLimitStore,
      `rl:botblocker:challenge-read:ip:${clientIp(request) ?? "unknown"}`,
      300,
      60,
    );
    const webhookSite = await botBlockerSites.findByWebhookId(webhookId);
    if (!webhookSite) return notFound();
    if (challengeId.length < 16) {
      return botBlockerError("invalid_request", 400);
    }
    const site = await botBlockerRuntimeSecurity.authorizeRead({
      authorizationHeader:
        request.headers.get("authorization") ?? undefined,
      requestOrigin: request.nextUrl.origin,
      body: envelope,
    });
    if (site.siteId !== webhookSite._id) {
      return botBlockerError("audience_mismatch", 403);
    }
    return botBlockerUnavailable("not_implemented", false);
  } catch (error) {
    return mapBotBlockerRuntimeError(error);
  }
}

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function mapBotBlockerRuntimeError(error: unknown): NextResponse {
  if (error instanceof ApiError && error.code === "rate_limited") {
    return botBlockerUnavailable("rate_limited", true, 429);
  }
  if (error instanceof BotBlockerSiteCredentialError) {
    return error.code === "botblocker_credentials_unavailable"
      ? botBlockerUnavailable("dependency_unavailable", true)
      : botBlockerError(
          error.code === "idempotency_key_conflict"
            ? "idempotency_key_conflict"
            : "authentication_required",
          error.statusCode,
        );
  }
  if (error instanceof BotBlockerRuntimeError) {
    if (error.unavailable || error.code === "dependency_unavailable") {
      return botBlockerUnavailable("dependency_unavailable", true);
    }
    const code: BotBlockerErrorCode =
      error.code === "idempotency_key_required"
        ? "invalid_request"
        : error.code;
    return botBlockerError(code, error.statusCode);
  }
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
