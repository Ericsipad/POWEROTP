/**
 * Parses a comma-separated `ADMIN_ALLOWED_IPS` value and checks a client
 * IP against it. Exact matches only (no CIDR ranges) — deliberately
 * simple, matching how this operator configures allowlists elsewhere.
 */
export function isIpAllowed(clientIp: string | undefined, allowedIps: string | undefined): boolean {
  if (!allowedIps) return false;
  if (!clientIp) return false;
  const allowlist = allowedIps
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return allowlist.includes(clientIp);
}
