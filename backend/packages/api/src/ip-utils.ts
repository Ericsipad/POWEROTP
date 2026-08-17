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

/**
 * Converts an already-`normalizeIp`-canonicalized IPv4 address to an
 * unsigned 32-bit integer, matching `botblockerNetworkRangesV4`'s
 * `rangeStart`/`rangeEnd` encoding. Multiplication (not bit-shifting) is
 * used deliberately: a left-shifted top octet overflows JS's signed
 * 32-bit bitwise operand range, while the full unsigned result
 * (max 4294967295) fits safely within `Number.MAX_SAFE_INTEGER`.
 */
export function ipv4ToUint32(normalizedIpv4: string): number | undefined {
  const octets = normalizedIpv4.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }
  return octets[0]! * 2 ** 24 + octets[1]! * 2 ** 16 + octets[2]! * 2 ** 8 + octets[3]!;
}

/**
 * Converts an already-`normalizeIp`-canonicalized IPv6 address to a
 * fixed-width 32-character zero-padded lowercase hex string, matching
 * `botblockerNetworkRangesV6`'s `rangeStartHex`/`rangeEndHex` encoding. A
 * 128-bit value doesn't fit safely in a JS/BSON number and `Decimal128`
 * can't hold the full IPv6 range exactly; a fixed-width zero-padded hex
 * string of equal length sorts identically to numeric comparison, so this
 * expands `::` compression and any embedded IPv4 tail (e.g.
 * `64:ff9a::192.0.2.1`) into the full eight 16-bit groups rather than
 * using a library or a BigInt round trip.
 */
const HEX_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;

export function ipv6ToFixedWidthHex(normalizedIpv6: string): string | undefined {
  const groups = expandIpv6Groups(normalizedIpv6);
  if (!groups || groups.length !== 8 || groups.some((group) => !HEX_GROUP_PATTERN.test(group))) {
    return undefined;
  }
  return groups.map((group) => group.toLowerCase().padStart(4, "0")).join("");
}

function expandIpv6Groups(normalizedIpv6: string): string[] | undefined {
  const sides = normalizedIpv6.split("::");
  if (sides.length > 2) return undefined;
  const [head, tail] = sides;

  const splitGroups = (part: string | undefined): string[] =>
    part ? part.split(":") : [];
  const expandIpv4Tail = (groups: string[]): string[] | undefined => {
    const last = groups.at(-1);
    if (!last?.includes(".")) return groups;
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return undefined;
    }
    const [a, b, c, d] = octets as [number, number, number, number];
    return [
      ...groups.slice(0, -1),
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16),
    ];
  };

  const headGroups = expandIpv4Tail(splitGroups(head));
  const tailGroups = expandIpv4Tail(splitGroups(tail));
  if (!headGroups || !tailGroups) return undefined;

  if (sides.length === 1) return headGroups;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return undefined;
  return [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
}

export type RangeLookupKey =
  | { family: "v4"; value: number }
  | { family: "v6"; value: string };

/**
 * Shared by the IP blacklist and network-range persistence so every
 * caller derives the same encoded lookup key for the same raw IP:
 * normalizes, classifies family, and converts to the collection's own
 * range-comparable encoding (`ipv4ToUint32`/`ipv6ToFixedWidthHex`).
 * Returns `undefined` for anything that is not a valid IPv4/IPv6 address.
 */
export function encodeIpForRangeLookup(ip: string): RangeLookupKey | undefined {
  const normalized = normalizeIp(ip);
  const family = normalized ? ipFamily(normalized) : undefined;
  if (!normalized || !family) return undefined;
  if (family === "v4") {
    const value = ipv4ToUint32(normalized);
    return value === undefined ? undefined : { family, value };
  }
  const value = ipv6ToFixedWidthHex(normalized);
  return value === undefined ? undefined : { family, value };
}
