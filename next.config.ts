import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei", "@pixiv/three-vrm"],
  async rewrites() {
    return [{ source: "/api/game/:path*", destination: "http://127.0.0.1:43128/:path*" }];
  },
};

export default nextConfig;
