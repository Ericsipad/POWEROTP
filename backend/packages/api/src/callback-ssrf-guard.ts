import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
];

function ipv4ToInt(address: string) {
  return address
    .split(".")
    .reduce((accumulator, part) => (accumulator << 8) + Number(part), 0);
}

function isBlockedIpv4(address: string) {
  const target = ipv4ToInt(address);
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : ~0 << (32 - prefix);
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:") // IPv4-mapped addresses must be checked as IPv4
  );
}

export function isBlockedIpAddress(address: string) {
  if (isIPv4(address)) return isBlockedIpv4(address);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isBlockedIpv4(mapped[1]!);
  return isBlockedIpv6(address);
}

export class CallbackSsrfError extends Error {}

/**
 * Resolves the callback hostname and rejects loopback, private, link-local,
 * multicast, and cloud metadata destinations. Called before the initial
 * request and again before following any redirect.
 */
export async function assertPublicHttpsUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new CallbackSsrfError("Callback delivery requires HTTPS");
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new CallbackSsrfError("Callback hostname did not resolve");
  }
  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new CallbackSsrfError("Callback destination is not publicly routable");
    }
  }
  return url;
}
