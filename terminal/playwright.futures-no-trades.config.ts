import { defineConfig } from "@playwright/test";
import base from "./playwright.futures-workspace.config";
export default defineConfig({ ...base, testMatch: /futures-no-trades\.spec\.ts/ });
