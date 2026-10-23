import { defineConfig } from "@playwright/test";
import base from "./playwright.futures.config";
const port = Number(process.env.TERMINAL_E2E_PORT || 3596);
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({
  ...base, testMatch: /futures-workspace\.spec\.ts/,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...server, command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/dev/futures`, reuseExistingServer: false },
});
