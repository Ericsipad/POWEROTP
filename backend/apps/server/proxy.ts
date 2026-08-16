import { NextResponse, type NextRequest } from "next/server";

import { configuredBrowserOriginsForPath, corsHeaders } from "@/lib/cors";

export function proxy(request: NextRequest): NextResponse {
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
  matcher: ["/v1/:path*", "/mcp"],
};
