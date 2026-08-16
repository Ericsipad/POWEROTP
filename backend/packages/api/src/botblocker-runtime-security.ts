import { createHash } from "node:crypto";

import type { Redis } from "ioredis";

import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import type { ProductionConfig } from "./config.js";
import {
  BotBlockerSiteCredentialService,
  type AuthenticatedBotBlockerSite,
} from "./botblocker-site-credential-service.js";
import type { RuntimeBotBlockerSite } from "./botblocker-site-service.js";
import { BotBlockerVisitorTokenService } from "./botblocker-visitor-token.js";

const REQUEST_WINDOW_MS = 300_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface BotBlockerRuntimeEnvelope {
  siteId: string;
  gateSessionId: string;
  audience: string;
  nonce: string;
  issuedAt: number;
}

export { BotBlockerRuntimeError } from "./botblocker-errors.js";

export class BotBlockerRuntimeSecurity {
  constructor(
    private readonly credentials: Pick<
      BotBlockerSiteCredentialService,
      "authenticate"
    >,
    private readonly visitorTokens: Pick<
      BotBlockerVisitorTokenService,
      "verify"
    >,
    private readonly valkey: Redis,
    private readonly config: Pick<
      ProductionConfig,
      "BOTBLOCKER_RUNTIME_ORIGIN"
    >,
  ) {}

  async authorizeMutation(options: {
    authorizationHeader?: string;
    requestOrigin: string;
    idempotencyKey?: string;
    operation: string;
    authentication: "site_credential" | "visitor_token";
    runtimeSite: RuntimeBotBlockerSite;
    body: BotBlockerRuntimeEnvelope;
    rawBody: unknown;
    now?: number;
  }): Promise<AuthenticatedBotBlockerSite> {
    const now = options.now ?? Date.now();
    const site = await this.#authenticateAndValidate({
      authorizationHeader: options.authorizationHeader,
      requestOrigin: options.requestOrigin,
      authentication: options.authentication,
      runtimeSite: options.runtimeSite,
      body: options.body,
      now,
    });
    
    const idempotencyKey = options.idempotencyKey;
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 200
    ) {
      throw new BotBlockerRuntimeError("idempotency_key_required", 400);
    }
    const requestHash = digest(options.rawBody);
    const idempotencyResult = await this.#claim(
      `botblocker:idempotency:v1:${digest([
        site.siteId,
        options.operation,
        idempotencyKey,
      ])}`,
      requestHash,
      IDEMPOTENCY_TTL_MS,
    );
    if (idempotencyResult === "conflict") {
      throw new BotBlockerRuntimeError("idempotency_key_conflict", 409);
    }

    const nonceResult = await this.#claim(
      `botblocker:request-nonce:v1:${digest([
        site.siteId,
        options.body.audience,
        options.operation,
        options.body.nonce,
      ])}`,
      digest(idempotencyKey),
      REQUEST_WINDOW_MS,
    );
    if (nonceResult === "conflict") {
      throw new BotBlockerRuntimeError("replay_detected", 409);
    }
    return site;
  }

  authorizeRead(options: {
    authorizationHeader?: string;
    requestOrigin: string;
    runtimeSite: RuntimeBotBlockerSite;
    body: BotBlockerRuntimeEnvelope;
    now?: number;
  }) {
    return this.#authenticateAndValidate({
      ...options,
      authentication: "visitor_token",
      now: options.now ?? Date.now(),
    });
  }

  async #authenticateAndValidate(options: {
    authorizationHeader?: string;
    requestOrigin: string;
    authentication: "site_credential" | "visitor_token";
    runtimeSite: RuntimeBotBlockerSite;
    body: BotBlockerRuntimeEnvelope;
    now: number;
  }): Promise<AuthenticatedBotBlockerSite> {
    const site =
      options.authentication === "site_credential"
        ? await this.credentials.authenticate(options.authorizationHeader)
        : this.#authenticateVisitor(options);
    if (
      site.customerId !== options.runtimeSite.customerId ||
      site.projectId !== options.runtimeSite.projectId ||
      site.siteId !== options.runtimeSite.siteId
    ) {
      throw new BotBlockerRuntimeError("audience_mismatch", 403);
    }
    const configuredOrigin = this.config.BOTBLOCKER_RUNTIME_ORIGIN;
    if (!configuredOrigin) {
      throw new BotBlockerRuntimeError(
        "dependency_unavailable",
        503,
        true,
      );
    }
    if (new URL(options.requestOrigin).origin !== new URL(configuredOrigin).origin) {
      throw new BotBlockerRuntimeError("audience_mismatch", 403);
    }
    if (
      options.body.siteId !== site.siteId ||
      !site.allowedOrigins.includes(options.body.audience)
    ) {
      throw new BotBlockerRuntimeError("audience_mismatch", 403);
    }
    if (
      !Number.isSafeInteger(options.body.issuedAt) ||
      Math.abs(options.now - options.body.issuedAt) > REQUEST_WINDOW_MS
    ) {
      throw new BotBlockerRuntimeError("expired", 400);
    }
    return site;
  }

  #authenticateVisitor(options: {
    authorizationHeader?: string;
    runtimeSite: RuntimeBotBlockerSite;
    body: BotBlockerRuntimeEnvelope;
    now: number;
  }): AuthenticatedBotBlockerSite {
    this.visitorTokens.verify(
      options.authorizationHeader,
      {
        projectId: options.runtimeSite.projectId,
        siteId: options.runtimeSite.siteId,
        gateSessionId: options.body.gateSessionId,
        audience: options.body.audience,
      },
      options.now,
    );
    return {
      customerId: options.runtimeSite.customerId,
      projectId: options.runtimeSite.projectId,
      siteId: options.runtimeSite.siteId,
      enabled: options.runtimeSite.enabled,
      allowedOrigins: options.runtimeSite.allowedOrigins,
    };
  }

  async #claim(
    key: string,
    value: string,
    ttlMs: number,
  ): Promise<"created" | "duplicate" | "conflict"> {
    try {
      const stored = await this.valkey.set(key, value, "PX", ttlMs, "NX");
      if (stored === "OK") return "created";
      return (await this.valkey.get(key)) === value ? "duplicate" : "conflict";
    } catch {
      throw new BotBlockerRuntimeError(
        "dependency_unavailable",
        503,
        true,
      );
    }
  }
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url");
}
