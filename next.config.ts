import type { NextConfig } from "next";

// NEXT_EXPORT=1 → static export for the APK (Capacitor bundles ./out)
const isApk = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isApk
    ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } }
    : { output: "standalone" as const }),
  // v3.0: firebase-admin must stay a plain Node require (its gRPC/CJS deps
  // break when webpack bundles them) — the /api/admin/* routes depend on it
  serverExternalPackages: ["firebase-admin"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
