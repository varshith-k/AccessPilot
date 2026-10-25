import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The development badge would show up in demo recordings and covers content on small screens.
  devIndicators: false,
  // Playwright drives a real Chromium from the server; it must not be bundled.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
