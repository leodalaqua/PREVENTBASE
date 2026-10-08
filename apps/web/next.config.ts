import path from "node:path";
import type { NextConfig } from "next";

const apiDev = process.env.PREVENTBASE_API_DEV_URL ?? "http://localhost:3101";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return process.env.NODE_ENV === "production" ? [] : [{ source: "/api/:path*", destination: `${apiDev}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default config;
