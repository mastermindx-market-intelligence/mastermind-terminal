const path = require("node:path");
const { createRequire } = require("node:module");
const terminal = path.resolve(__dirname, "../../../terminal");
const fromTerminal = createRequire(path.join(terminal, "package.json"));
const { defineConfig } = fromTerminal("@playwright/test");
const base = require(path.join(terminal, "playwright.config.ts")).default;
const browser = process.env.FLOW_PROJECTION_BROWSER;
if (!["chromium", "webkit"].includes(browser)) throw new Error("Explicit supported FLOW_PROJECTION_BROWSER is required");
const output = process.env.FLOW_PROJECTION_PROOF_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error("Absolute operation-owned output directory is required");
if (Array.isArray(base.webServer) || !base.webServer) throw new Error("Unexpected incumbent fixture-server contract");
module.exports = defineConfig({
  ...base,
  testDir: path.join(terminal, "e2e"),
  globalSetup: path.join(terminal, "e2e/globalSetup.ts"),
  testMatch: "flow-projection.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(output, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(output, "report.json") }]],
  projects: base.projects.filter(project => ["desktop", "tablet", "mobile"].includes(project.name)).map(project => ({
    ...project,
    use: { ...project.use, browserName: browser, colorScheme: browser === "webkit" ? "light" : "dark" },
  })),
  webServer: { ...base.webServer, cwd: terminal, reuseExistingServer: false },
});
