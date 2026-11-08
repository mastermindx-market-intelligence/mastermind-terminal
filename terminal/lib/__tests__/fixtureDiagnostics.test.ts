import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { project, checkout, record, OUTPUT_DIRECTORY, OUTPUT_FILE } from "../../e2e/fixtureDiagnostics.cjs";
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-diagnostics-"));
  for (const relative of ["playwright.config.ts", "e2e/globalSetup.ts", "e2e/fixtureWarmup.cjs", "e2e/fixtureDiagnostics.cjs", "e2e/company-intelligence.spec.ts", "package.json", "package-lock.json"]) {
    const p = path.join(root, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "fixture source\n");
  }
  return root;
}
const commit = "a".repeat(40), tree = "b".repeat(40), parent = "c".repeat(40);
const run = (_command: string, args: string[]) => args.includes("HEAD^{tree}") || args.some((v) => v.endsWith("^{tree}")) ? tree : args.includes("--format=%P") ? parent : commit;
describe("bounded incumbent startup artifact", () => {
  it("loads the actual TS global setup through installed Playwright without invoking it", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const script = `
      const path = require("node:path");
      const { transform } = require(path.join(process.argv[1], "node_modules/playwright/lib/common/index.js"));
      let requests = 0;
      global.fetch = async () => { requests++; throw Error("load-only control must not request"); };
      (async () => {
        try {
          const loaded = await transform.requireOrImport(path.join(process.argv[1], "e2e/globalSetup.ts"));
          console.log(JSON.stringify({ loaded: typeof loaded.default === "function", requests }));
        } catch (error) {
          console.log(JSON.stringify({ loaded: false, requests, errorName: error.name, message: error.message }));
          process.exitCode = 1;
        }
      })();
    `;
    const result = spawnSync(process.execPath, ["-e", script, root], {
      cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ loaded: true, requests: 0 });
  });

  it("projects only known diagnostics and no arbitrary body/header/error contents", () => {
    const row = project({ phase: "route", route: "/analysis", status: 200, bodyComplete: false, headersReceived: true, timedOut: true, errorName: "private-secret", body: "private-secret", headers: { Authorization: "private-secret" }, url: "private-secret" });
    expect(row).toMatchObject({ route: "/analysis", status: 200, bodyComplete: false, headersReceived: true, timedOut: true, errorName: "OtherError" });
    expect(JSON.stringify(row)).not.toContain("private-secret");
    expect(project({ phase: "summary", routes: 14, headersReceived: 14, timedOut: 1 })).toMatchObject({ routes: 14, headersReceived: 14, timedOut: 1 });
  });
  it("binds actual checkout/tree/parents and source hashes without execution", () => {
    const root = fixture();
    try {
      const data = checkout(root, run);
      expect(data).toMatchObject({ commit, tree, parents: [parent] });
      expect(Object.keys(data.sources)).toHaveLength(7);
      expect(Object.values(data.sources).every((v) => /^[0-9a-f]{64}$/.test(String(v)))).toBe(true);
      expect(() => checkout(root, () => "unqualified")).toThrow(/unqualified/);
      let heads = 0;
      expect(() => checkout(root, (command: string, args: string[]) => args.join(" ") === "rev-parse HEAD" && ++heads > 1 ? parent : run(command, args))).toThrow(/changed/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("retains startup binding outside Playwright's cleared test-results", () => {
    const root = fixture();
    try {
      record({ phase: "checkout" }, { cwd: root, run });
      record({ phase: "global_setup_started" }, { cwd: root });
      record({ phase: "global_setup_failed", errorName: "FixtureHtmlReadinessUnavailable" }, { cwd: root });
      fs.mkdirSync(path.join(root, "test-results")); fs.rmSync(path.join(root, "test-results"), { recursive: true });
      const rows = fs.readFileSync(path.join(root, OUTPUT_DIRECTORY, OUTPUT_FILE), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows.map((row) => row.phase)).toEqual(["checkout", "global_setup_started", "global_setup_failed"]);
      expect(rows[0].checkout.commit).toBe(commit);
      expect(rows.every((row) => row.observerPid === process.pid)).toBe(true);
      expect(rows.at(-1).phase).not.toBe("global_setup_complete");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("refuses symlink directories and file aliases without writing the target", () => {
    const root = fixture(); const outside = fixture();
    try {
      fs.symlinkSync(outside, path.join(root, OUTPUT_DIRECTORY), "dir");
      expect(() => record({ phase: "route" }, { cwd: root })).toThrow(/directory/);
      expect(fs.readdirSync(outside)).not.toContain(OUTPUT_FILE);
      fs.unlinkSync(path.join(root, OUTPUT_DIRECTORY)); fs.mkdirSync(path.join(root, OUTPUT_DIRECTORY));
      const target = path.join(outside, "target"); fs.writeFileSync(target, "sentinel");
      fs.symlinkSync(target, path.join(root, OUTPUT_DIRECTORY, OUTPUT_FILE));
      expect(() => record({ phase: "route" }, { cwd: root })).toThrow();
      expect(fs.readFileSync(target, "utf8")).toBe("sentinel");
      fs.unlinkSync(path.join(root, OUTPUT_DIRECTORY, OUTPUT_FILE)); fs.linkSync(target, path.join(root, OUTPUT_DIRECTORY, OUTPUT_FILE));
      expect(() => record({ phase: "route" }, { cwd: root })).toThrow(/file/);
      expect(fs.readFileSync(target, "utf8")).toBe("sentinel");
    } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });
});
