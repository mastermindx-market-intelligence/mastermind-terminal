/**
 * Playwright config for the prod-build canary leg.
 *
 * Spreads the repository config unchanged and swaps ONLY the webServer command
 * from `npm run dev` to `npm run start`. The fixture env block is inherited as-is
 * (NEXT_PUBLIC_* keys are already inlined by the build step that produced .next).
 *
 * Used by .github/workflows/e2e-prodbuild-canary.yml and the allowlisted
 * terminal-e2e-prodbuild lane in .github/workflows/ci.yml; the dev lane keeps
 * using playwright.config.ts unchanged.
 */
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const port = Number(process.env.TERMINAL_E2E_PORT || 3108);
// The repository config defines exactly one webServer; the spread below keeps
// every other field of it untouched for this leg.
const baseWebServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer[0]
  : baseConfig.webServer;

export default defineConfig({
  ...baseConfig,
  webServer: {
    ...baseWebServer,
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      ...baseWebServer?.env,
      // The ONLY production runtime that may reach the BFF fixture branches:
      // lib/fixtureSeam.ts requires this exact marker next to NODE_ENV=production.
      // A fixture variable alone on a real host keeps every route live.
      TERMINAL_E2E_CANARY: "1",
    },
  },
});
