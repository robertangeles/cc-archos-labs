import { defineConfig, devices } from "@playwright/test";

// ============================================================================
// Playwright E2E config. Targets the local dev server (PORT 3007 from
// .env.local) and reuses it if already running. Auth is established per-test by
// registering a fresh user against the real API — Turnstile is bypassed unless
// TURNSTILE_ENABLED is set, and same-origin CSRF passes because requests carry
// Origin: http://localhost:3007 (matching NEXT_PUBLIC_SITE_URL). No test
// backdoor is added to the app.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
