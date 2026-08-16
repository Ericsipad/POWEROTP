import type { NextConfig } from "next";

const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    if (!apiBase) return [];
    return [
      {
        source: "/v1/:path*",
        destination: `${apiBase}/v1/:path*`,
        permanent: false,
      },
      {
        source: "/mcp",
        destination: `${apiBase}/mcp`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
