import { NextResponse, type NextRequest } from "next/server";

import { configuredBrowserOriginsForPath, corsHeaders } from "@/lib/cors";
import {
  hostedAuthHealthPayload,
  hostedAuthDeploymentEnvironment,
  isHostedAuthHostname,
  resolveHostedAuthRealm,
} from "@/lib/hosted-auth-realms";

export function proxy(request: NextRequest): NextResponse {
  const hostname = request.nextUrl.hostname;
  if (isHostedAuthHostname(hostname)) {
    const realm = resolveHostedAuthRealm(
      hostname,
      hostedAuthDeploymentEnvironment(),
    );
    if (!realm || request.nextUrl.pathname !== "/health/hosted-auth") {
      return NextResponse.json(
        { error: "hosted_auth_route_unavailable" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      hostedAuthHealthPayload(realm),
      { headers: { "cache-control": "no-store" } },
    );
  }

  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.next();

  if (!configuredBrowserOriginsForPath(request.nextUrl.pathname).has(origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
