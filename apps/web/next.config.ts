import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // @ffmpeg-installer/ffmpeg resolves its platform binary via dynamic require()
  // branching at runtime, which the bundler cannot statically analyze. Leaving it
  // (and the AWS SDK packages that pull in similarly dynamic optional dependencies)
  // as a real Node require() avoids "Module not found" errors at build time.
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
};

export default nextConfig;
