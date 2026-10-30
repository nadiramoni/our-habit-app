import type { NextConfig } from "next";

// NEXT_EXPORT=1 → static export for the APK (Capacitor bundles ./out)
const isApk = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isApk
    ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } }
    : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
