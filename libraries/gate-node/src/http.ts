import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  HttpMethodSchema,
  RequestContextSchema,
  type BotBlockerErrorResponse,
  type BotBlockerUnavailableResponse,
  type RequestContext,
} from "@powerotp/contracts";

import type { GateNodeLimits, TrustedProxyConfig } from "./types.js";

export const DEFAULT_LIMITS: Required<GateNodeLimits> = {
  maxPathBytes: 2_048,
  maxHeaderBytes: 16_384,
  maxHeaderCount: 100,
  maxBodyBytes: 64 * 1_024,
};

export function isInfrastructureExcluded(path: string): boolean {
  return (
    path === "/_powerotp" ||
    path.startsWith("/_powerotp/") ||
    path === "/.well-known/powerotp-agent" ||
    path === "/health" ||
    path.startsWith("/health/") ||
    path === "/healthz" ||
    path === "/ready" ||
    path === "/readyz" ||
    path === "/live" ||
    path === "/livez" ||
    path === "/.well-known/health" ||
    path.startsWith("/.well-known/health/") ||
    path.startsWith("/_next/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/static/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  );
}

export function isSameOriginBridgeRequest(
  request: IncomingMessage,
  audience: string,
): boolean {
  if (request.headers["x-powerotp-bridge"] !== "1") return false;
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== "string" || origin.length > 2_048) return false;
  try {
    return new URL(origin).origin === new URL(audience).origin;
  } catch {
    return false;
  }
}

export function requestPath(request: IncomingMessage, maxBytes: number): string | undefined {
  const raw = request.url ?? "/";
  if (
    Buffer.byteLength(raw) > maxBytes ||
    raw.includes("\0") ||
    raw.includes("\\") ||
    /%(?:2f|5c)/i.test(raw)
  ) {
    return undefined;
  }
  try {
    const path = new URL(raw, "http://localhost").pathname;
    if (Buffer.byteLength(path) > maxBytes || !path.startsWith("/")) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

export function withinHeaderLimits(
  request: IncomingMessage,
  limits: Required<GateNodeLimits>,
): boolean {
  if (request.rawHeaders.length / 2 > limits.maxHeaderCount) return false;
  return request.rawHeaders.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) <=
    limits.maxHeaderBytes;
}

export function buildRequestContext(options: {
  request: IncomingMessage;
  path: string;
  siteId: string;
  trustedProxy?: TrustedProxyConfig;
}): RequestContext | undefined {
  const method = HttpMethodSchema.safeParse(options.request.method);
  if (!method.success) return undefined;
  const clientIp = resolveClientIp(options.request, options.trustedProxy);
  const parsed = RequestContextSchema.safeParse({
    siteId: options.siteId,
    method: method.data,
    path: options.path,
    ...(clientIp ? { clientIp } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

export function validateTrustedProxy(config: TrustedProxyConfig | undefined): void {
  if (!config) return;
  if (config.trustedRemoteAddresses.length === 0) {
    throw new TypeError("Trusted proxy addresses cannot be empty");
  }
  for (const address of config.trustedRemoteAddresses) {
    if (address === "*" || isIP(stripMapped(address)) === 0) {
      throw new TypeError("Trusted proxy addresses must be explicit IP addresses");
    }
  }
  if (config.select !== "first" && config.select !== "last") {
    throw new TypeError("Trusted proxy address selection must be explicit");
  }
  if (
    config.expectedProxyCount !== undefined &&
    (!Number.isSafeInteger(config.expectedProxyCount) ||
      config.expectedProxyCount < 1 ||
      config.expectedProxyCount > 32)
  ) {
    throw new TypeError("Expected proxy count must be an integer from 1 through 32");
  }
  if (config.header === "x-real-ip" && config.expectedProxyCount !== undefined) {
    if (config.expectedProxyCount !== 1) {
      throw new TypeError("X-Real-IP supports exactly one expected proxy");
    }
  }
}

export function resolveClientIp(
  request: IncomingMessage,
  config: TrustedProxyConfig | undefined,
): string | undefined {
  const remote = stripMapped(request.socket.remoteAddress ?? "");
  if (!config) return isIP(remote) ? remote : undefined;
  const trusted = config.trustedRemoteAddresses.map(stripMapped);
  if (!trusted.includes(remote)) return isIP(remote) ? remote : undefined;
  const header = request.headers[config.header];
  if (typeof header !== "string" || header.length > 512) return undefined;
  const values = header.split(",").map((value) => stripMapped(value.trim()));
  if (config.header === "x-real-ip" && values.length !== 1) return undefined;
  if (
    config.expectedProxyCount !== undefined &&
    values.length !== config.expectedProxyCount
  ) {
    return undefined;
  }
  const selected = config.select === "last" ? values.at(-1) : values[0];
  return selected && isIP(selected) ? selected : undefined;
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new HttpInputError(415);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new HttpInputError(413);
    chunks.push(buffer);
  }
  if (bytes === 0) throw new HttpInputError(400);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpInputError(400);
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: BotBlockerErrorResponse | BotBlockerUnavailableResponse | object,
): void {
  if (response.headersSent) return;
  const value = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(value),
    "x-content-type-options": "nosniff",
  });
  response.end(value);
}

export class HttpInputError extends Error {
  constructor(readonly status: number) {
    super("Invalid HTTP input");
  }
}

function stripMapped(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}
