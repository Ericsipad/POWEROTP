const ALLOWED_METHODS = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = [
  "authorization",
  "content-type",
  "idempotency-key",
  "if-none-match",
  "x-botblocker-audience",
  "x-botblocker-issued-at",
  "x-botblocker-nonce",
  "x-botblocker-site-id",
  "x-csrf-token",
  "x-interaction-token",
].join(", ");

export function configuredBrowserOriginsForPath(
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const origins = [
    env.PUBLIC_APP_URL,
    ...(pathname.startsWith("/v1/botblocker/")
      ? [env.BOTBLOCKER_RUNTIME_ORIGIN]
      : []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value).origin);
  return new Set(origins);
}

export function corsHeaders(origin: string): Headers {
  return new Headers({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-origin": origin,
    "access-control-max-age": "600",
    vary: "Origin",
  });
}
