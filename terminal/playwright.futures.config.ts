import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Focused development acceptance on the same app and existing fixture/auth rules.
// Avoid the global route warmup for unrelated Terminal workspaces.
const port = Number(process.env.TERMINAL_E2E_PORT || 3594);
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: /futures-lab\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: "list",
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...server,
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/dev/futures`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
