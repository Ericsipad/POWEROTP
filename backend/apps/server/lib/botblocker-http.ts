import { ApiError } from "@powerotp/api/errors.js";
import {
  BotBlockerRuntimeError,
  BotBlockerSiteCredentialError,
} from "@powerotp/api/botblocker-errors.js";
import type { AuthenticatedBotBlockerSite } from "@powerotp/api/botblocker-site-credential-service.js";
import { withVerifiedBotBlockerWebhook } from "@powerotp/api/botblocker-webhook.js";
import {
  BotBlockerSessionDataResponseSchema,
  type BotBlockerErrorCode,
  type BotBlockerRuntimeRequestEnvelope,
  type RapidAuthRequest,
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

export async function rapidAuthMutation(
  request: NextRequest,
  webhookId: string,
  schema: ZodType<RapidAuthRequest>,
  hooks: {
    endpointSecret?: string;
    loadContext?: () => Promise<ServerContext>;
  } = {},
): Promise<NextResponse> {
  const preflight = verifyWebhookPath(webhookId, hooks.endpointSecret);
  if (!preflight) return notFound();

  const context = await (hooks.loadContext ?? getServerContext)();
  const runtimeSite = await context.botBlockerSites.resolveRuntimeSite({
    projectId: preflight.projectId,
    siteId: preflight.siteId,
    webhookId,
  });
  if (!runtimeSite) return notFound();
  if (!runtimeSite.projectActive || !runtimeSite.enabled) return offline();

  try {
    await enforceRateLimit(
      context.dataStores.rateLimitStore,
      `rl:botblocker:rapid-auth:ip:${clientIp(request) ?? "unknown"}`,
      120,
      60,
    );
    const rawBody = await request.json();
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) return botBlockerError("invalid_request", 400);
    const body: RapidAuthRequest = parsed.data;
    const site = await context.botBlockerRuntimeSecurity.authorizeMutation({
      authorizationHeader:
        request.headers.get("authorization") ?? undefined,
      requestOrigin: request.nextUrl.origin,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? undefined,
      operation: "rapid-auth",
      authentication: "site_credential",
      runtimeSite,
      body,
      rawBody,
    });
    await enforceRateLimit(
      context.dataStores.rateLimitStore,
      `rl:botblocker:rapid-auth:site:${site.siteId}`,
      600,
      60,
    );
    const requestIp = body.payload.request.clientIp;
    const intelligence = await context.botBlockerNetworkIntelligence.resolve(
      requestIp,
      new Date(),
    );
    await context.botBlockerIngestion.startSession({
      scope: {
        customerId: site.customerId,
        projectId: site.projectId,
        siteId: site.siteId,
      },
      gateSessionId: body.gateSessionId,
      initialRequest: body,
      ...(requestIp ? { ipBlacklisted: intelligence.blacklisted } : {}),
      ...(intelligence.blacklisted ? { latestDecision: "otp" } : {}),
      ...(intelligence.networkClassification
        ? { networkClassification: intelligence.networkClassification }
        : {}),
      ...(intelligence.ipReputation ? { ipReputation: intelligence.ipReputation } : {}),
    });
    const issued = context.botBlockerVisitorTokens.issue({
      projectId: site.projectId,
      siteId: site.siteId,
      gateSessionId: body.gateSessionId,
      audience: body.audience,
    });
    await context.botBlockerIngestion.saveVisitorTokenMetadata({
      scope: {
        customerId: site.customerId,
        projectId: site.projectId,
        siteId: site.siteId,
      },
      gateSessionId: body.gateSessionId,
      metadata: issued.metadata,
    });
    return NextResponse.json({
      status: "ready",
      visitorToken: issued.token,
      expiresAt: issued.claims.expiresAt,
      decision: intelligence.blacklisted
        ? { status: "ready", outcome: "otp" }
        : { status: "unavailable", reason: "not_implemented", retryable: false },
    });
  } catch (error) {
    return mapBotBlockerRuntimeError(error);
  }
}

/**
 * Subsequent visitor mutations first verify the immutable endpoint token
 * locally, before loading any shared service. Only then may the exact signed
 * project/site scope resolve, the body parse, and the scoped visitor token,
 * rate limits, replay controls, or business logic run.
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
  hooks: {
    endpointSecret?: string;
    loadContext?: () => Promise<ServerContext>;
  } = {},
): Promise<NextResponse> {
  const preflight = verifyWebhookPath(webhookId, hooks.endpointSecret);
  if (!preflight) return notFound();

  const context = await (hooks.loadContext ?? getServerContext)();
  const { botBlockerRuntimeSecurity, dataStores } = context;
  const runtimeSite = await context.botBlockerSites.resolveRuntimeSite({
    projectId: preflight.projectId,
    siteId: preflight.siteId,
    webhookId,
  });
  if (!runtimeSite) return notFound();
  if (!runtimeSite.projectActive || !runtimeSite.enabled) return offline();

  try {
    await enforceRateLimit(
      dataStores.rateLimitStore,
      `rl:botblocker:${operation}:ip:${clientIp(request) ?? "unknown"}`,
      120,
      60,
    );
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
      authentication: "visitor_token",
      runtimeSite,
      body: envelope,
      rawBody: body,
    });
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
  const preflight = verifyWebhookPath(webhookId);
  if (!preflight) return notFound();

  const envelope = {
    siteId: request.headers.get("x-botblocker-site-id") ?? "",
    gateSessionId:
      request.headers.get("x-botblocker-gate-session-id") ?? "",
    audience: request.headers.get("x-botblocker-audience") ?? "",
    nonce: request.headers.get("x-botblocker-nonce") ?? "",
    issuedAt: Number(request.headers.get("x-botblocker-issued-at")),
  };
  const { botBlockerSites, botBlockerRuntimeSecurity, dataStores } =
    await getServerContext();
  const runtimeSite = await botBlockerSites.resolveRuntimeSite({
    projectId: preflight.projectId,
    siteId: preflight.siteId,
    webhookId,
  });
  if (!runtimeSite) return notFound();
  if (!runtimeSite.projectActive || !runtimeSite.enabled) return offline();
  try {
    await enforceRateLimit(
      dataStores.rateLimitStore,
      `rl:botblocker:challenge-read:ip:${clientIp(request) ?? "unknown"}`,
      300,
      60,
    );
    if (challengeId.length < 16) {
      return botBlockerError("invalid_request", 400);
    }
    await botBlockerRuntimeSecurity.authorizeRead({
      authorizationHeader:
        request.headers.get("authorization") ?? undefined,
      requestOrigin: request.nextUrl.origin,
      runtimeSite,
      body: envelope,
    });
    return botBlockerUnavailable("not_implemented", false);
  } catch (error) {
    return mapBotBlockerRuntimeError(error);
  }
}

export async function botBlockerSessionDataRead(
  request: NextRequest,
  webhookId: string,
): Promise<NextResponse> {
  const preflight = verifyWebhookPath(webhookId);
  if (!preflight) return notFound();
  const eventId = request.headers.get("x-botblocker-event-id") ?? "";
  const envelope = {
    siteId: request.headers.get("x-botblocker-site-id") ?? "",
    gateSessionId:
      request.headers.get("x-botblocker-gate-session-id") ?? "",
    audience: request.headers.get("x-botblocker-audience") ?? "",
    nonce: request.headers.get("x-botblocker-nonce") ?? "",
    issuedAt: Number(request.headers.get("x-botblocker-issued-at")),
  };
  if (
    eventId.length < 16 ||
    eventId.length > 128 ||
    envelope.gateSessionId.length < 16
  ) {
    return botBlockerError("invalid_request", 400);
  }

  const context = await getServerContext();
  const runtimeSite = await context.botBlockerSites.resolveRuntimeSite({
    projectId: preflight.projectId,
    siteId: preflight.siteId,
    webhookId,
  });
  if (!runtimeSite) return notFound();
  if (!runtimeSite.projectActive || !runtimeSite.enabled) return offline();
  try {
    await enforceRateLimit(
      context.dataStores.rateLimitStore,
      `rl:botblocker:session-data:ip:${clientIp(request) ?? "unknown"}`,
      300,
      60,
    );
    const site = await context.botBlockerRuntimeSecurity.authorizeRead({
      authorizationHeader:
        request.headers.get("authorization") ?? undefined,
      requestOrigin: request.nextUrl.origin,
      runtimeSite,
      body: envelope,
    });
    const data = await context.botBlockerIngestion.getCurrentSessionData(
      site,
      envelope.gateSessionId,
      eventId,
    );
    return NextResponse.json(BotBlockerSessionDataResponseSchema.parse(data), {
      headers: { "cache-control": "no-store" },
    });
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

function verifyWebhookPath(webhookId: string, secret?: string) {
  return withVerifiedBotBlockerWebhook(
    webhookId,
    secret ?? process.env.BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET,
    (claims) => claims,
  );
}

function offline(): NextResponse {
  return NextResponse.json(
    {
      status: "offline",
      reason: "site_inactive",
      retryAfterMs: 30_000,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
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
