/**
 * Playwright config for the prod-build canary leg.
 *
 * Spreads the repository config unchanged and swaps ONLY the webServer command
 * from `npm run dev` to `npm run start`. The fixture env block is inherited as-is
 * (NEXT_PUBLIC_* keys are already inlined by the build step that produced .next).
 *
 * Used only by .github/workflows/e2e-prodbuild-canary.yml; never referenced by
 * playwright.config.ts or any other workflow.
 */
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const port = Number(process.env.TERMINAL_E2E_PORT || 3108);
const baseWebServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer[0]
  : baseConfig.webServer;

export default defineConfig({
  ...baseConfig,
  webServer: {
    ...baseWebServer,
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
  },
});
