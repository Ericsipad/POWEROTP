export interface SafeReturnOptions {
  origin: string;
  isApprovedPath(pathname: string): boolean;
  fallbackPath?: string;
}

function isPathCandidate(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/%(?:0[ad]|2f|5c)/i.test(value)
  );
}

function normalizeApprovedPath(candidate: string, options: SafeReturnOptions): string | undefined {
  if (!isPathCandidate(candidate)) return undefined;

  const base = new URL(options.origin);
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username ||
    base.password
  ) {
    return undefined;
  }

  const resolved = new URL(candidate, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password) return undefined;
  if (!options.isApprovedPath(resolved.pathname)) return undefined;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * Returns only an approved same-origin relative destination. Absolute and
 * protocol-relative URLs are rejected even when they happen to share origin,
 * keeping the return token independent of deployment host aliases.
 */
export function resolveSafeReturn(candidate: unknown, options: SafeReturnOptions): string {
  const fallback = normalizeApprovedPath(options.fallbackPath ?? "/", options);
  if (!fallback) throw new Error("Safe return fallback must be an approved same-origin path");

  if (typeof candidate === "string") {
    const approved = normalizeApprovedPath(candidate, options);
    if (approved) return approved;
  }

  return fallback;
}
