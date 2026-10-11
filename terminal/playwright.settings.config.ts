import { defineConfig } from "@playwright/test";

// Focused real-component fixture; no production services or market-data warmup.
const port = Number(process.env.TERMINAL_E2E_PORT || 3197);
export default defineConfig({
  testDir: "./e2e", testMatch: "settings-redesign.spec.ts",
  timeout: 45_000, expect: { timeout: 10_000 }, workers: 1,
  reporter: "list", outputDir: "test-results/settings-redesign",
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", reducedMotion: "reduce", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/dev/settings?s=terminal&out=1`,
    reuseExistingServer: !process.env.CI, timeout: 180_000,
    env: {
      ANALYSIS_LOCAL_PREVIEW: "1", ADMIN_DEV: "1", TERMINAL_E2E_FIXTURE: "1",
      TERMINAL_E2E_EMAIL: "responsive@example.com", TERMINAL_E2E_ENTITLEMENT: "unlimited",
      RATE_LIMIT_MAX: "100000", HUB_REALTIME_QUOTES: "1", FLOW_FIXTURE: "1",
      // The established local fixture values, never production credentials.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    },
  },
});
