export class InvalidIpCidrError extends Error {}

interface ParsedIp {
  family: 4 | 6;
  bits: 32 | 128;
  value: bigint;
}

export function canonicalizeIpCidr(input: string): string {
  const parts = input.trim().split("/");
  if (parts.length !== 2 || !/^(0|[1-9]\d{0,2})$/u.test(parts[1]!)) {
    throw new InvalidIpCidrError("invalid_ip_cidr");
  }
  const ip = parseIp(parts[0]!);
  const prefix = Number(parts[1]);
  if (prefix > ip.bits) throw new InvalidIpCidrError("invalid_ip_cidr");

  const hostBits = BigInt(ip.bits - prefix);
  const network = hostBits === 0n
    ? ip.value
    : ip.value & ~((1n << hostBits) - 1n);
  return `${formatIp({ ...ip, value: network })}/${prefix}`;
}

export function isIpAllowed(address: string | undefined, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return true;
  if (!address) return false;

  try {
    const ip = parseIp(address);
    return cidrs
      .map((cidr) => {
        const [networkText, prefixText] = canonicalizeIpCidr(cidr).split("/");
        const network = parseIp(networkText!);
        return { network, prefix: Number(prefixText) };
      })
      .some(({ network, prefix }) => {
        if (network.family !== ip.family) return false;
        const hostBits = BigInt(ip.bits - prefix);
        const mask = hostBits === 0n ? -1n : ~((1n << hostBits) - 1n);
        return (ip.value & mask) === network.value;
      });
  } catch {
    return false;
  }
}

function parseIp(input: string): ParsedIp {
  if (input !== input.trim() || input.includes("%") || input.includes("[") || input.includes("]")) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  if (input.includes(":")) return parseIpv6(input);
  return parseIpv4(input);
}

function parseIpv4(input: string): ParsedIp {
  const octets = input.split(".");
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^(0|[1-9]\d{0,2})$/u.test(octet) || Number(octet) > 255)
  ) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  return {
    family: 4,
    bits: 32,
    value: octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n),
  };
}

function parseIpv6(input: string): ParsedIp {
  // Dotted and zone-qualified forms are intentionally rejected so IPv4 can
  // never bypass IPv4 policy through an alternate IPv6 representation.
  if (input.includes(".") || !/^[0-9a-f:]+$/iu.test(input)) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  const compressed = input.indexOf("::");
  if (compressed !== input.lastIndexOf("::")) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  if (compressed < 0 && input.split(":").some((group) => group.length === 0)) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  const left = (compressed < 0 ? input : input.slice(0, compressed))
    .split(":")
    .filter(Boolean);
  const right = (compressed < 0 ? "" : input.slice(compressed + 2))
    .split(":")
    .filter(Boolean);
  const explicit = [...left, ...right];
  if (
    explicit.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group)) ||
    (compressed < 0 && explicit.length !== 8) ||
    (compressed >= 0 && explicit.length >= 8)
  ) {
    throw new InvalidIpCidrError("invalid_ip_address");
  }
  const groups = compressed < 0
    ? explicit
    : [...left, ...Array<string>(8 - explicit.length).fill("0"), ...right];
  const value = groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
  if ((value >> 32n) === 0xffffn) {
    throw new InvalidIpCidrError("ipv4_mapped_ipv6_not_allowed");
  }
  return { family: 6, bits: 128, value };
}

function formatIp(ip: ParsedIp): string {
  if (ip.family === 4) {
    return [24n, 16n, 8n, 0n]
      .map((shift) => Number((ip.value >> shift) & 0xffn))
      .join(".");
  }
  const groups = Array.from(
    { length: 8 },
    (_, index) => Number((ip.value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16),
  );
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}
