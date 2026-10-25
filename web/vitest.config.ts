import { defineConfig } from "vitest/config";

// Unit and integration tests live under src/. The browser smoke tests in e2e/ run under Playwright.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
