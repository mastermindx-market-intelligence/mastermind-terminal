import { defineConfig } from "@playwright/test";

const port = Number(process.env.TERMINAL_E2E_PORT || 43721);
const origin = "http://127.0.0.1:" + port;

/** Small isolated Plan-comparison browser qualifier. The canonical full suite
 * remains mandatory for actual integration; this does not replace hosted CI. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /options-(?:plan-scenario-comparison|plan-compare-mounted|plan-payoff|shortlist-plan)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port " + port,
    url: origin + "/dev/options-plan?lang=en",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ANALYSIS_LOCAL_PREVIEW: "1",
      TERMINAL_E2E_FIXTURE: "1",
      TERMINAL_E2E_EMAIL: "responsive@example.com",
      TERMINAL_E2E_ENTITLEMENT: "unlimited",
      FLOW_FIXTURE: "1",
      RATE_LIMIT_MAX: "100000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    },
  },
});
