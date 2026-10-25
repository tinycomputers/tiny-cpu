import { defineConfig, devices } from "@playwright/test";

// The smoke test serves the production build (`pnpm build`) with `astro preview`.
// Browsers: `pnpm exec playwright install chromium` once (CI does this).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4321", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm preview --port 4321 --host localhost",
    url: "http://localhost:4321/app/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
