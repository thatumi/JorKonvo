import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = resolve(__dirname, "..");

/**
 * End-to-end suite: the real web build in a real Chromium against a
 * throwaway Synapse (e2e/docker-compose.yml, started by e2e/scripts/up.sh).
 *
 * `npm run test:e2e` assumes the homeserver is already up on :18448 and the
 * app has been built (`npm run build`) - `webServer` below serves the
 * static build with `vite preview`.
 */
const HS_URL = process.env.E2E_HOMESERVER ?? "https://localhost:18448";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    // The test homeserver is fronted by Caddy's internal-CA TLS so the app
    // hits an https:// origin (the production CSP forbids plain http).
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // rust-crypto wasm + fake media for anything call-related.
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run preview --workspace=apps/web -- --port 4173 --strictPort",
    cwd: repoRoot,
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  metadata: { homeserver: HS_URL },
});
