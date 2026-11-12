import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Options access checks require the incumbent single test server");

// The broad suite deliberately bypasses Options access with FLOW_FIXTURE=1.
// This focused configuration exercises the real gate using loopback auth only.
export default defineConfig({
  ...base,
  // These access states intentionally do not mount or qualify a paid data feed.
  globalSetup: undefined,
  testMatch: /options-access\.spec\.ts/,
  projects: base.projects?.filter((project) => ["desktop", "tablet", "mobile"].includes(project.name ?? "")).map((project) => ({
    ...project,
    metadata: { ...project.metadata, optionsAccess: true },
  })),
  webServer: {
    ...server,
    env: {
      ...server.env,
      MMX_SHARED_SHELL: "1",
      FLOW_FIXTURE: "0",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    },
  },
});
