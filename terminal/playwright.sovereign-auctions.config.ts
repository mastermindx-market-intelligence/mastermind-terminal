import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// An isolated, explicitly selected local port is required. Reusing an unrelated
// checkout's server could produce screenshots of the wrong code or session.
const port = Number(process.env.TERMINAL_E2E_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 54321) {
  throw new Error("Set a free dedicated TERMINAL_E2E_PORT before this local source verification");
}
if (!base.webServer || Array.isArray(base.webServer)) throw new Error("Review changed base Playwright webServer configuration");
const projects = base.projects?.filter(project => ["desktop", "tablet", "mobile"].includes(project.name ?? ""));
if (projects?.length !== 3) throw new Error("The three canonical responsive projects must exist");
export default defineConfig({
  ...base,
  projects,
  testMatch: /sovereign-auction-context\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: { ...base.webServer, reuseExistingServer: false },
});
