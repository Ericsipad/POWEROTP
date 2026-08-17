import { isIP } from "node:net";

/**
 * Canonicalizes a trusted request IP for storage/lookup: strips an IPv4
 * `::ffff:` mapped prefix and lowercases/normalizes IPv6 via `URL` hostname
 * parsing. Returns `undefined` for anything that is not a valid IPv4/IPv6
 * address. Shared by BotBlocker ingestion and the network-intelligence
 * (IP blacklist / network-range) persistence so every caller derives the
 * same canonical value for the same input.
 */
export function normalizeIp(value: string): string | undefined {
  const withoutMappedPrefix = value.toLowerCase().startsWith("::ffff:")
    ? value.slice(7)
    : value;
  const version = isIP(withoutMappedPrefix);
  if (version === 4) return withoutMappedPrefix;
  if (version !== 6) return undefined;
  return new URL(`http://[${withoutMappedPrefix}]/`).hostname.slice(1, -1);
}

export type IpFamily = "v4" | "v6";

/** Determines the address family of an already-`normalizeIp`-canonicalized
 * value. Returns `undefined` for anything that is not a valid IPv4/IPv6
 * address. */
export function ipFamily(normalizedIp: string): IpFamily | undefined {
  const version = isIP(normalizedIp);
  if (version === 4) return "v4";
  if (version === 6) return "v6";
  return undefined;
}
