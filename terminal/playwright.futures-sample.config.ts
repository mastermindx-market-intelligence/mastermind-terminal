import { defineConfig } from "@playwright/test";
import base from "./playwright.futures.config";
const port = Number(process.env.TERMINAL_E2E_PORT || 3594);
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({ ...base,
  testMatch: /futures-sample\.local\.spec\.ts/,
  use: { ...base.use, screenshot: "off", trace: "off" },
  webServer: { ...server!, url: `http://127.0.0.1:${port}/dev/futures-sample` },
});
