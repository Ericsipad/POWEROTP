import { NextRequest, NextResponse } from "next/server";

import {
  hostedAuthDeploymentEnvironment,
  resolveHostedAuthRealm,
} from "@/lib/hosted-auth-realms";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export function GET(request: NextRequest) {
  const environment = hostedAuthDeploymentEnvironment();
  const realm = resolveHostedAuthRealm(request.nextUrl.hostname, environment);
  if (!realm) {
    return NextResponse.json(
      { error: "hosted_auth_realm_unavailable" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      service: "powerotp-hosted-auth",
      status: "ok",
      environment: realm.environment,
      identityDataMode: realm.identityDataMode,
      realm: realm.hostname,
      rpId: realm.rpId,
    },
    { headers: NO_STORE_HEADERS },
  );
}
