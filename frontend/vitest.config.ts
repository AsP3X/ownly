// Human: Vitest configuration for frontend unit tests (API helpers and pure lib code).
// Agent: USES Vite resolve aliases; EXCLUDES Playwright e2e specs under e2e/.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
  },
});
