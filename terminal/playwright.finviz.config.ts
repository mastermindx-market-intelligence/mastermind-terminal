import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Focused qualification of the same production components, with explicit
// browser/viewport boundaries. FINVIZ_PROOF_PAYLOAD selects retained owner bytes.
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: /finviz-discovery\.spec\.ts/,
  workers: 1,
  retries: 0,
  projects: ["chromium", "webkit"].flatMap(browserName => [
    { name: `${browserName}-desktop`, use: { browserName: browserName as "chromium" | "webkit", viewport: { width: 1440, height: 900 } } },
    { name: `${browserName}-tablet`, use: { browserName: browserName as "chromium" | "webkit", viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: `${browserName}-mobile`, use: { browserName: browserName as "chromium" | "webkit", viewport: { width: 390, height: 844 }, hasTouch: true } },
  ]),
});
