import { createSecret, hashToken, safeEqual } from "./security.js";

const WEBHOOK_VERSION = 1;
const WEBHOOK_PREFIX = "bwh_";
const MAX_WEBHOOK_ID_LENGTH = 512;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{80,400}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface BotBlockerWebhookClaims {
  version: 1;
  endpointId: string;
  projectId: string;
  siteId: string;
}

interface CompactWebhookClaims {
  v: 1;
  e: string;
  p: string;
  s: string;
}

export function createBotBlockerWebhookId(
  projectId: string,
  siteId: string,
  secret: string,
): string {
  requireSecret(secret);
  const payload: CompactWebhookClaims = {
    v: WEBHOOK_VERSION,
    e: createSecret(18),
    p: projectId,
    s: siteId,
  };
  const encoded = encodePayload(payload);
  return `${WEBHOOK_PREFIX}${encoded}.${signatureFor(encoded, secret)}`;
}

/**
 * Verifies only local syntax and cryptographic binding. It performs no I/O,
 * so runtime routes can reject random paths before loading shared services.
 */
export function verifyBotBlockerWebhookId(
  webhookId: string,
  secret: string | undefined,
): BotBlockerWebhookClaims | undefined {
  if (
    !secret ||
    webhookId.length > MAX_WEBHOOK_ID_LENGTH ||
    !webhookId.startsWith(WEBHOOK_PREFIX)
  ) {
    return undefined;
  }
  const token = webhookId.slice(WEBHOOK_PREFIX.length);
  const separator = token.indexOf(".");
  if (separator < 0 || separator !== token.lastIndexOf(".")) return undefined;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!PAYLOAD_PATTERN.test(encoded) || !SIGNATURE_PATTERN.test(signature)) {
    return undefined;
  }
  if (!safeEqual(signature, signatureFor(encoded, secret))) return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isClaims(payload) || encodePayload(payload) !== encoded) return undefined;
  return {
    version: payload.v,
    endpointId: payload.e,
    projectId: payload.p,
    siteId: payload.s,
  };
}

export function withVerifiedBotBlockerWebhook<T>(
  webhookId: string,
  secret: string | undefined,
  onVerified: (claims: BotBlockerWebhookClaims) => T,
): T | undefined {
  const claims = verifyBotBlockerWebhookId(webhookId, secret);
  return claims ? onVerified(claims) : undefined;
}

function signatureFor(encoded: string, secret: string): string {
  return hashToken(`botblocker-webhook-endpoint-v1\0${encoded}`, secret);
}

function encodePayload(payload: CompactWebhookClaims): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function isClaims(value: unknown): value is CompactWebhookClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return (
    Object.keys(claims).length === 4 &&
    claims.v === WEBHOOK_VERSION &&
    isId(claims.e, 24, 24, /^[A-Za-z0-9_-]+$/) &&
    isId(claims.p, 16, 80, /^[A-Za-z0-9_-]+$/) &&
    isId(claims.s, 16, 80, /^[A-Za-z0-9_-]+$/)
  );
}

function isId(
  value: unknown,
  minimum: number,
  maximum: number,
  pattern: RegExp,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    pattern.test(value)
  );
}

function requireSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET is not configured");
  }
}
