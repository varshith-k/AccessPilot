import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Playwright drives a real Chromium from the server; it must not be bundled.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
