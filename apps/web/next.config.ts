import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No "standalone" output: this app is embedded via Next's programmatic
  // server API inside the single unified process (see
  // apps/api/src/server.ts) rather than run via its own `.next/standalone`
  // bundle, so the regular build output is what gets used.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
