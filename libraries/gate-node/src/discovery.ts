import type { ServerResponse } from "node:http";

import { sendJson } from "./http.js";
import type { GateNodeOptions } from "./types.js";

export interface PowerOtpAgentDiscovery {
  protocolVersion: 1;
  provider: "POWEROTP";
  cleanDataPage?: {
    url: string;
    metadataUrl?: string;
  };
}

export function createAgentDiscovery(
  cleanDataPage: GateNodeOptions["cleanDataPage"],
): PowerOtpAgentDiscovery {
  if (!cleanDataPage) return { protocolVersion: 1, provider: "POWEROTP" };
  const url = powerOtpHostedUrl(cleanDataPage.url);
  const metadataUrl = cleanDataPage.metadataUrl
    ? powerOtpHostedUrl(cleanDataPage.metadataUrl)
    : undefined;
  return {
    protocolVersion: 1,
    provider: "POWEROTP",
    cleanDataPage: {
      url,
      ...(metadataUrl ? { metadataUrl } : {}),
    },
  };
}

export function sendAgentDiscovery(
  response: ServerResponse,
  discovery: PowerOtpAgentDiscovery,
  headOnly = false,
): void {
  if (!headOnly) {
    sendJson(response, 200, discovery);
    return;
  }
  const value = JSON.stringify(discovery);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(value),
    "x-content-type-options": "nosniff",
  });
  response.end();
}

function powerOtpHostedUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.hostname !== "powerotp.com" && !url.hostname.endsWith(".powerotp.com"))
  ) {
    throw new TypeError("CleanDataPage discovery URLs must be POWEROTP-hosted HTTPS URLs");
  }
  return url.toString();
}
