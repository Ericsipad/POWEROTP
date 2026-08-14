import type { IncomingMessage, ServerResponse } from "node:http";

import { verifySiteClearance } from "@powerotp/botblocker-signing";
import type {
  BotBlockerVerificationKeySet,
} from "@powerotp/botblocker-signing";
import { SignedSiteClearanceSchema } from "@powerotp/contracts";

import type { ClearanceVerification } from "./types.js";

const MAX_COOKIE_HEADER_BYTES = 8_192;
const COOKIE_NAME = /^[A-Za-z0-9_]+$/;

export function readCookie(request: IncomingMessage, name: string): string | undefined {
  assertCookieName(name);
  const header = request.headers.cookie;
  if (!header || Buffer.byteLength(header) > MAX_COOKIE_HEADER_BYTES) return undefined;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return undefined;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
    found = value;
  }
  return found;
}

export function encodeClearance(clearance: unknown): string {
  const parsed = SignedSiteClearanceSchema.parse(clearance);
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
}

export function verifyClearanceCookie(options: {
  value: string | undefined;
  verificationKeys: BotBlockerVerificationKeySet;
  audience: string;
  siteId: string;
  gateSessionId: string;
  now: number;
}): ClearanceVerification {
  if (!options.value || options.value.length > 8_192) return { valid: false };
  let clearance: unknown;
  try {
    const decoded = Buffer.from(options.value, "base64url");
    if (decoded.toString("base64url") !== options.value) return { valid: false };
    clearance = JSON.parse(decoded.toString("utf8"));
  } catch {
    return { valid: false };
  }
  const result = verifySiteClearance({
    clearance,
    verificationKeys: options.verificationKeys,
    expectedAudience: options.audience,
    expectedSiteId: options.siteId,
    expectedGateSessionId: options.gateSessionId,
    now: options.now,
  });
  return result.ok ? { valid: true, clearance: result.value } : { valid: false };
}

export function appendPrivateCookie(
  response: ServerResponse,
  name: string,
  value: string,
  options: { secure: boolean; expiresAt?: number; now?: number },
): void {
  assertCookieName(name);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Cookie value is unsafe");
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ];
  if (options.expiresAt !== undefined) {
    const maxAge = Math.max(
      0,
      Math.floor((options.expiresAt - (options.now ?? Date.now())) / 1_000),
    );
    attributes.push(`Max-Age=${maxAge}`, `Expires=${new Date(options.expiresAt).toUTCString()}`);
  }
  const existing = response.getHeader("set-cookie");
  const cookie = attributes.join("; ");
  response.setHeader("set-cookie", [
    ...(Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []),
    cookie,
  ]);
}

function assertCookieName(name: string): void {
  if (!COOKIE_NAME.test(name)) throw new TypeError("Cookie name is invalid");
}
