import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const recipes = [
  "capture_pl6_batch1.cjs",
  "capture_gex_levels_heatmap_load_failure.cjs",
  "capture_eod_heatmap_flowdesk_load_failure.cjs",
];

function finishCapture(recipe: string, failed: number, only: string | null = null) {
  const source = readFileSync(join(__dirname, "../../e2e/tools", recipe), "utf8");
  const parsed = ts.createSourceFile(recipe, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const main = parsed.statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "main",
  );
  if (!main?.body) throw new Error("Capture recipe has no main function");
  // Execute the real post-cleanup finalization. Browser/server creation and test
  // bodies are outside this slice and cannot run in this in-memory check.
  const statements = main.body.statements;
  const cleanup = statements.findIndex((node) => ts.isTryStatement(node) && node.finallyBlock?.getText(parsed).includes("stopServer(child)"));
  if (cleanup < 0) throw new Error("Capture cleanup boundary not found");
  const start = cleanup + 1;
  const finalization = statements.slice(start).map((node) => node.getText(parsed)).join("\n");
  const manifestPath = "/capture/EVIDENCE.yml";
  const original = "previous complete manifest\n";
  const disk = new Map([[manifestPath, original]]);
  const writes: string[] = [];
  const state = { exitCode: 0 };
  const file = "example-1440.png";
  runInNewContext(`(function () {\n${finalization}\n})()`, {
    failed,
    only,
    ONLY: only ? [only] : [],
    layoutFilesBlock: () => [],
    readdirSync: () => [],
    updateHeatmap: false,
    files: [file],
    process: state,
    console: { log() {} },
    OUT: "/capture",
    LAYOUT_FILES: [],
    STATES: { example: { board: "gex", replies: {} } },
    URLS: { gex: "/fixture" },
    STATIC_MANIFEST: "/data/fixture.json",
    capturedAtHead: "a".repeat(40),
    join,
    writeFileSync(path: string, contents: string) {
      writes.push(path);
      disk.set(path, contents);
    },
  }, { timeout: 1000 });
  return { original, manifest: disk.get(manifestPath), writes, exitCode: state.exitCode, file };
}

describe.each(recipes)("%s manifest finalization", (recipe) => {
  it("keeps the previous complete manifest when any full-run crop fails", () => {
    const result = finishCapture(recipe, 1);
    expect(result.exitCode).toBe(1);
    expect(result.writes).toEqual([]);
    expect(result.manifest).toBe(result.original);
  });

  it("writes the successful full-run manifest from the actual captured file list", () => {
    const result = finishCapture(recipe, 0);
    expect(result.exitCode).toBe(0);
    expect(result.writes).toEqual(["/capture/EVIDENCE.yml"]);
    expect(result.manifest).toContain(`  - ${result.file}`);
    expect(result.manifest).toContain(`# capturedAtHead: ${"a".repeat(40)}`);
  });

  it.each([0, 1])("preserves the manifest for a diagnostic subset with %i failures", (failed) => {
    const result = finishCapture(recipe, failed, "^example-");
    expect(result.exitCode).toBe(failed ? 1 : 0);
    expect(result.writes).toEqual([]);
    expect(result.manifest).toBe(result.original);
  });
});
