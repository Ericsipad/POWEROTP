/**
 * Parses a comma-separated `ADMIN_ALLOWED_IPS` value and checks a client
 * IP against it. Exact matches only (no CIDR ranges) — deliberately
 * simple, matching how this operator configures allowlists elsewhere.
 *
 * One explicit exception: the literal entry `0.0.0.0` (the conventional
 * "any address" value, as in CIDR `0.0.0.0/0`) disables the IP check
 * entirely and allows every client IP. This is a deliberate operator
 * opt-out, not a bug — but it means admin login then relies on the
 * password alone, dropping one of the two factors `docs/THREAT_MODEL.md`
 * calls for ("Restrict platform admin login to an IP allowlist"). Prefer
 * listing real IPs; only use `0.0.0.0` if you understand and accept that
 * tradeoff (e.g. temporarily, from a genuinely dynamic IP).
 */
export function isIpAllowed(clientIp: string | undefined, allowedIps: string | undefined): boolean {
  if (!allowedIps) return false;
  const allowlist = allowedIps
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (allowlist.includes("0.0.0.0")) return true;
  if (!clientIp) return false;
  return allowlist.includes(clientIp);
}
