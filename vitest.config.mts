import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
      "lib/agent/**/*.test.ts",
      "app/api/**/*.test.ts",
      "demo-site/**/*.test.ts",
      "lib/ai/**/*.test.ts",
    ],
    restoreMocks: true,
    // Full-app flows and axe audits render the whole workspace in jsdom. They take 1–3 s alone,
    // and the 5 s default leaves no headroom when every worker runs at once on a busy machine.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html"],
      include: ["lib/client/**", "lib/contracts/**", "lib/twinly/**", "hooks/**", "components/**"],
      thresholds: {
        lines: 85,
      },
    },
  },
});
