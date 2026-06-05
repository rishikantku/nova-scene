import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/static/:path*",
        destination: "https://pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/scenes/:path*",
      },
    ];
  },
};

export default nextConfig;
