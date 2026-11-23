import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "same-origin" }] }];
  },
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
