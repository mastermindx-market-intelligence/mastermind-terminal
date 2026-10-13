import { defineConfig } from "@playwright/test";

// Dedicated config for the chart-engine performance protocol (B1–B6).
// testDir is ./bench and testMatch is **/*.bench.ts so the responsive suite
// and CI shards (which pick e2e/**/*.spec.ts) never collect these tests.

const port = Number(process.env.TERMINAL_E2E_PORT || 3110);
const baseURL = process.env.BENCH_BASE_URL || `http://127.0.0.1:${port}`;

// The protocol is ONE test that measures IMPLS × RUNS pages, each with a 500-tick live pass
// and a BENCH_SOAK-switch resetData soak over five 40k-row series. Scale the cap with that
// work instead of pinning 12 min for the whole matrix.
const impls = Math.max(
  1,
  (process.env.BENCH_IMPLS ?? "mm,lwc")
    .split(",")
    .filter((s) => s.trim() === "mm" || s.trim() === "lwc").length,
);
const runs = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
const PER_RUN_MINUTES = 8;

const benchEnv = {
  ANALYSIS_LOCAL_PREVIEW: "1",
  ADMIN_DEV: "1",
  TERMINAL_E2E_FIXTURE: "1",
  TERMINAL_E2E_EMAIL: "responsive@example.com",
  TERMINAL_E2E_ENTITLEMENT: "unlimited",
  RATE_LIMIT_MAX: "100000",
  HUB_REALTIME_QUOTES: "1",
  TICKER_NEWS_RAIL: "1",
  FLOW_FIXTURE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
};

export default defineConfig({
  testDir: "./bench",
  testMatch: "**/*.bench.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: impls * runs * PER_RUN_MINUTES * 60 * 1000,
  reporter: "list",
  use: {
    baseURL,
    headless: process.env.BENCH_HEADLESS === "1",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    launchOptions: {
      args: ["--disable-partial-raster"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  ...(process.env.BENCH_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
          url: `${baseURL}/dev/chart-bench`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: benchEnv,
        },
      }),
});
