/** Weak comparison for GET/HEAD If-None-Match validators (RFC 9110). */
export function ifNoneMatchMatches(
  ifNoneMatch: string | null,
  currentEtag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const normalizedCurrent = currentEtag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === normalizedCurrent;
  });
}
