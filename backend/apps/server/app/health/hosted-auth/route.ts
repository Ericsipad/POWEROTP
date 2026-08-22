import { NextRequest, NextResponse } from "next/server";

import {
  hostedAuthHealthPayload,
  resolveHostedAuthRealmFromRequestAuthorities,
} from "@/lib/hosted-auth-realms";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export function GET(request: NextRequest) {
  const realm = resolveHostedAuthRealmFromRequestAuthorities([
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    request.nextUrl.host,
  ]);
  if (!realm) {
    return NextResponse.json(
      { error: "hosted_auth_realm_unavailable" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(hostedAuthHealthPayload(realm), {
    headers: NO_STORE_HEADERS,
  });
}
