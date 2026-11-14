import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Trough checks require the incumbent single test server");

/** Reuses the company-case fixture origin; rollout stays default-off elsewhere. */
export default defineConfig({
  ...base,
  testMatch: /prophet-trough-read\.spec\.ts/,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  projects: [{ name: "trough-layouts", metadata: { troughEnabled: true }, use: { viewport: { width: 390, height: 844 }, hasTouch: true } }],
  webServer: {
    ...server,
    reuseExistingServer: false,
    env: { ...server.env, NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED: "1" },
  },
});
