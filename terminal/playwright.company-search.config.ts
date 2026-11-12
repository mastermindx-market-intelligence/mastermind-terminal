import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const port = Number(process.env.TERMINAL_E2E_PORT || 32025);
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({ ...base, testMatch: /company-alternate-listing\.spec\.ts/,
  globalSetup: undefined, workers: 1, retries: 0,
  projects: base.projects?.filter(project => ["desktop", "tablet", "mobile"].includes(project.name ?? "")),
  webServer: { ...server, url: `http://127.0.0.1:${port}/discover`, reuseExistingServer: false,
    command: server?.command ?? `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: { ...server?.env, MMX_SHARED_SHELL: "1" } },
});
