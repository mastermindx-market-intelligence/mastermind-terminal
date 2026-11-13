import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The canonical `/prophet` mount (Shared Shell) browser proof.
 *
 * The default suite drives the legacy `/options?tab=prophet` mount because the
 * Options hub's fixture path is always available there. The canonical route
 * gates on the shared shell + live member identity + the options entitlement,
 * so it gets its own server with `MMX_SHARED_SHELL=1` and its own port: an
 * already-running default-suite dev server (no shared shell, other fixtures)
 * must never be reused for these assertions.
 *
 * The page itself carries a development-only fixture seam gated on
 * `PROPHET_CANONICAL_FIXTURE`, set only here so other fixture servers keep the
 * real shared-shell mount; production still fails closed through the real reads.
 */
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Canonical Prophet checks require the incumbent single test server");

const port = Number(process.env.TERMINAL_E2E_CANONICAL_PORT || 3112);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: /prophet-canonical\.spec\.ts/,
  use: { ...base.use, baseURL },
  projects: base.projects
    ?.filter((project) => ["desktop", "tablet", "mobile"].includes(project.name ?? ""))
    .map((project) => ({ ...project, metadata: { ...project.metadata, canonicalProphet: true } })),
  webServer: {
    ...server,
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/prophet`,
    env: {
      ...server.env,
      MMX_SHARED_SHELL: "1",
      TERMINAL_E2E_FIXTURE: "1",
      PROPHET_CANONICAL_FIXTURE: "1",
    },
  },
});
