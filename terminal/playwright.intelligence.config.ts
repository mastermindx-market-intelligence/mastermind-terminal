import { requireOwnedReportOutputs } from "./e2e/fixtures/native-intelligence-contract";
import { defineConfig } from "@playwright/test";
import incumbent from "./playwright.config";
const server = Array.isArray(incumbent.webServer) ? incumbent.webServer[0] : incumbent.webServer;
if (!server || !server.env?.NEXT_PUBLIC_SUPABASE_URL) throw Error("Missing incumbent owned fixture server");
const origin = new URL(server.env.NEXT_PUBLIC_SUPABASE_URL).origin;
requireOwnedReportOutputs(__dirname, { json: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,
  last: process.env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE });
/** One explicit ordinary-CI config, same compiler/globalSetup/profiles/lifecycle.
 * Default suites never receive this subject-only fixture or local billing base.
 * No attachment to an already running process with a different environment.
 */
export default defineConfig({
  ...incumbent,
  testMatch: "**/native-intelligence-entrances.journey.ts",
  outputDir: "test-results/native-intelligence",
  // Dedicated output/report namespace: Playwright may clear ONLY this subtree.
  // Incumbent serial ordinary/Shared Shell traces and reporter files survive.
  reporter: process.env.CI ? [["github"], ["./e2e/reporters/retainedProgress.mjs"],
    ["json", { outputFile: "test-results/native-intelligence/report.json" }]] : [["list"],
    ["json", { outputFile: "test-results/native-intelligence/report.json" }]],
  projects: incumbent.projects?.filter(project => ["desktop", "tablet", "mobile"].includes(project.name ?? "")),
  webServer: { ...server, reuseExistingServer: false, env: { ...server.env,
    MMX_SHARED_SHELL: "1", TERMINAL_E2E_NATIVE_INTELLIGENCE: "1",
    BILLING_GATEWAY_BASE: origin + "/api/__e2e__/native-intelligence/billing",
  } },
});
