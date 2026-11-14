import { defineConfig } from "@playwright/test";
import canonical from "./playwright.prophet-canonical.config";

/** Reuses the incumbent local canonical fixture server, never production auth. */
export default defineConfig({ ...canonical, testMatch: /prophet-native\.spec\.ts/, workers: 1,
  use: { ...canonical.use, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined },
});
