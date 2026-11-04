import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "../../../playwright.config";

// Same route, fixtures, auth seam and projects as the repository config.
// Only local startup gets more time after the observed 120s server-start timeout.
// No test assertion timeout, source behavior or deployment setting is changed.
const root = path.resolve(__dirname, "../../..");
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected the existing single dev server");
export default defineConfig({
  ...base,
  testDir: path.join(root, "e2e"),
  globalSetup: path.join(root, "e2e/globalSetup.ts"),
  outputDir: path.join(root, "test-results"),
  retries: 0,
  webServer: { ...server, cwd: root, timeout: 300_000 },
});
