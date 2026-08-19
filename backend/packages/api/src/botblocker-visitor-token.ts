import { createHash } from "node:crypto";

import { z } from "zod";

import type { ProductionConfig } from "./config.js";
import { BotBlockerRuntimeError } from "./botblocker-errors.js";
import {
  createSecret,
  signPayload,
  verifySignedPayload,
} from "./security.js";

export const BOTBLOCKER_VISITOR_TOKEN_LIFETIME_MS = 30 * 60 * 1_000;

const BotBlockerVisitorSessionClaimsSchema = z
  .object({
    version: z.literal(1),
    tokenId: z.string().min(16).max(128),
    projectId: z.string().min(16).max(128),
    siteId: z.string().min(16).max(64),
    gateSessionId: z.string().min(16).max(128),
    audience: z.string().min(1).max(2_048),
    nonce: z.string().min(16).max(256),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

type BotBlockerVisitorSessionClaims = z.infer<
  typeof BotBlockerVisitorSessionClaimsSchema
>;

type VisitorTokenConfig = Pick<
  ProductionConfig,
  "BOTBLOCKER_VISITOR_TOKEN_SECRET"
>;

export class BotBlockerVisitorTokenService {
  readonly #secret: string | undefined;

  constructor(config: VisitorTokenConfig) {
    this.#secret = config.BOTBLOCKER_VISITOR_TOKEN_SECRET;
  }

  issue(
    scope: {
      projectId: string;
      siteId: string;
      gateSessionId: string;
      audience: string;
    },
    now = Date.now(),
  ): {
    token: string;
    claims: BotBlockerVisitorSessionClaims;
    metadata: {
      tokenId: string;
      expiresAt: Date;
      nonceDigest: string;
      tokenDigest: string;
    };
  } {
    const claims = BotBlockerVisitorSessionClaimsSchema.parse({
      version: 1,
      tokenId: `bvt_${createSecret(18)}`,
      ...scope,
      nonce: createSecret(16),
      issuedAt: now,
      expiresAt: now + BOTBLOCKER_VISITOR_TOKEN_LIFETIME_MS,
    });
    const token = signPayload(claims, this.#requireSecret());
    return {
      token,
      claims,
      metadata: {
        tokenId: claims.tokenId,
        expiresAt: new Date(claims.expiresAt),
        nonceDigest: digest(claims.nonce),
        tokenDigest: digest(token),
      },
    };
  }

  verify(
    authorizationHeader: string | undefined,
    expected: {
      projectId: string;
      siteId: string;
      gateSessionId: string;
      audience: string;
    },
    now = Date.now(),
  ): BotBlockerVisitorSessionClaims {
    const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader ?? "");
    if (!match) throw authenticationError();
    let claims: BotBlockerVisitorSessionClaims;
    try {
      claims = BotBlockerVisitorSessionClaimsSchema.parse(
        verifySignedPayload(match[1]!, this.#requireSecret()),
      );
    } catch {
      throw authenticationError();
    }
    if (
      claims.expiresAt <= now ||
      claims.issuedAt > now ||
      claims.projectId !== expected.projectId ||
      claims.siteId !== expected.siteId ||
      claims.gateSessionId !== expected.gateSessionId ||
      claims.audience !== expected.audience
    ) {
      throw authenticationError();
    }
    return claims;
  }

  #requireSecret(): string {
    if (!this.#secret) {
      throw new BotBlockerRuntimeError(
        "dependency_unavailable",
        503,
        true,
      );
    }
    return this.#secret;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function authenticationError(): BotBlockerRuntimeError {
  return new BotBlockerRuntimeError("authentication_required", 401);
}
