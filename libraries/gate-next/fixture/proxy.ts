import type { NextFetchEvent, NextRequest } from "next/server";

import { powerOtp } from "./powerotp.server";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return powerOtp.proxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|_powerotp(?:/|$)|\\.well-known/powerotp-agent(?:/|$)|health(?:/|$)|healthz$|ready$|readyz$|live$|livez$|\\.well-known/health(?:/|$)|assets(?:/|$)|static(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|ttf|txt|webmanifest|webp|woff2?)$).*)",
  ],
};
