/**
 * chartEngineBoundary.test.ts — renderer-coupling ratchet for the chart engine (G01).
 *
 * The masterplan (docs/CHART_ENGINE_MASTERPLAN.md) draws one boundary: everything above
 * the canvas renderer is ours, and the rented layer (lightweight-charts 5.2) may be
 * touched ONLY by lib/chart-engine/lwc/. Nothing enforces that at build time — a new
 * `import ... from "lightweight-charts"` in any component compiles fine and silently
 * widens the coupling the P3 canvas renderer would then have to cover. This test is the
 * fence: four static checks over source text, each of which can only get tighter.
 *
 *   (a) No file under lib/chart-engine/ outside lwc/ imports lightweight-charts —
 *       api.ts/index.ts (+ options.ts/time.ts/primitive.ts/canvas/** when sibling lanes
 *       land them) must stay renderer-agnostic, not even for types (masterplan law 1).
 *   (b) Outside lib/chart-engine, the importer set may only SHRINK: the allowlist below
 *       is the set measured at the G01 baseline (BASE_SHA c923cc46, 2026-10-11). A new
 *       importer fails; a file that went clean is tolerated and console.info'd so the
 *       parent tightens the list on the next pass.
 *   (c) `// engine-unwrap:` tags across lib/chart-engine/** + components/ChartPanel.tsx
 *       stay <= budget (8 at baseline). The escape hatch is grep-countable tech debt
 *       that must reach zero before P3 (masterplan law 2).
 *   (d) components/ChartPanel.tsx builds its chart only through createEngine from
 *       @/lib/chart-engine — the factory stays the single construction point.
 *
 * Matching is done on comment-stripped source so documentation mentions of the package
 * (api.ts's own header explains it must NOT import it) do not false-fail. The stripper
 * tracks string/template literals; its one blind spot is a regex literal containing a
 * quote character, which can only ever make a comment SURVIVE stripping (a loud, blessed
 * RED) — never hide a real import, because string-state text is emitted verbatim.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const TERMINAL_ROOT = path.resolve(__dirname, "..", "..");
const ENGINE_DIR = path.join(TERMINAL_ROOT, "lib", "chart-engine");
const LWC_ADAPTER_DIR = path.join(ENGINE_DIR, "lwc");
const CHART_PANEL = path.join(TERMINAL_ROOT, "components", "ChartPanel.tsx");

// Files that may import lightweight-charts today (measured at BASE_SHA c923cc46 with
// grep -rl 'from "lightweight-charts"' over components/ lib/ app/, tests excluded).
// Paths are relative to terminal/. Ratchet down only: entries leave this list, they
// never join it without an explicit, justified edit of this constant.
const LWC_IMPORT_ALLOWLIST: readonly string[] = [
  "app/embed/chart/EmbedChart.tsx",
  "components/ChartFrameBar.tsx",
  "components/ChartPanel.tsx",
  "components/ChartPane.tsx",
  "components/ChartSettingsModal.tsx",
  "components/TideChartLazy.tsx",
  "components/surface/SessionFlowPane.tsx",
  "components/surface/StrikeEvolutionModal.tsx",
  "components/surface/SurfacePane.tsx",
  "lib/chartTimeAxis.ts",
  "lib/drawingPaneReadiness.ts",
  "lib/heatSeries.ts",
  "lib/paneSync.ts",
  "lib/sessionShading.ts",
  "lib/surfaceContract.ts",
];

// Masterplan law 2: every unwrap() call site carries a `// engine-unwrap:` tag. Baseline
// (c923cc46): 7 in lib/chart-engine/** (6 handle declarations + 1 prose mention in
// api.ts's unwrap doc) + 1 bridge in ChartPanel.tsx = 8. P2 drives this to 0.
const ENGINE_UNWRAP_BUDGET = 8;

const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set([
  "node_modules", ".next", "__tests__", "fixtures", "e2e", "test-results",
  "playwright-report", "public", "coverage",
]);

/** Recursively collect .ts/.tsx files, skipping build/test directories. */
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

/** Remove line and block comments while preserving line numbers and string literals. */
function stripComments(src: string): string {
  let out = "";
  let quote: '"' | "'" | "`" | null = null;
  let block = false;
  let line = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = i + 1 < src.length ? src[i + 1] : "";
    if (line) {
      if (c === "\n") { line = false; out += c; }
      continue;
    }
    if (block) {
      if (c === "*" && next === "/") { block = false; i++; continue; }
      if (c === "\n") out += c; // keep newlines so stripped text stays line-aligned
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") {
        if (i + 1 < src.length) out += src[i + 1];
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "/" && next === "/") { line = true; i++; continue; }
    if (c === "/" && next === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    out += c;
  }
  return out;
}

/** Any live-code reference to the lightweight-charts module: static/dynamic import or require. */
const LWC_IMPORT_RE =
  /\bfrom\s*["']lightweight-charts["']|\brequire\s*\(\s*["']lightweight-charts["']\s*\)|\bimport\s*\(\s*["']lightweight-charts["']\s*\)|\bimport\s*["']lightweight-charts["']/;

const read = (f: string) => readFileSync(f, "utf8");
const toRel = (f: string) => path.relative(TERMINAL_ROOT, f).split(path.sep).join("/");
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Files under lib/chart-engine/ (all depths, lwc/ included). */
const ENGINE_FILES = walk(ENGINE_DIR).sort();
/** Engine files OUTSIDE the lwc/ adapter — the renderer-agnostic contract surface. */
const CONTRACT_FILES = ENGINE_FILES.filter((f) => !f.startsWith(LWC_ADAPTER_DIR));
/** Non-test sources outside lib/chart-engine where a NEW importer would widen coupling. */
const EXTERNAL_SOURCES = ["app", "components", "lib"]
  .flatMap((d) => walk(path.join(TERMINAL_ROOT, d)))
  .filter((f) => !f.startsWith(ENGINE_DIR))
  .sort();

/** The measured importer set: external files whose live code references the module. */
const EXTERNAL_IMPORTERS = EXTERNAL_SOURCES.filter((f) => LWC_IMPORT_RE.test(stripComments(read(f))));

describe("chart-engine renderer boundary (G01 ratchet)", () => {
  it("(a) the contract core exists: api.ts and index.ts are where the masterplan says", () => {
    expect(ENGINE_FILES.length, "lib/chart-engine/ walked empty — path resolution broke?").toBeGreaterThan(0);
    expect(existsSync(path.join(ENGINE_DIR, "api.ts")), "lib/chart-engine/api.ts is missing").toBe(true);
    expect(existsSync(path.join(ENGINE_DIR, "index.ts")), "lib/chart-engine/index.ts is missing").toBe(true);
  });

  it("(a) no file under lib/chart-engine/ outside lwc/ imports lightweight-charts", () => {
    // Covers api.ts, index.ts, axisZoom/futureTime/viewReset, and the sibling-lane files
    // options.ts / time.ts / primitive.ts / canvas/** the moment they land — the walk is
    // generic so a new file is fenced on its first commit, not after someone notices.
    expect(CONTRACT_FILES.length, "no non-lwc files under lib/chart-engine/ — walk is broken").toBeGreaterThan(0);
    const offenders = CONTRACT_FILES.flatMap((f) => {
      const stripped = stripComments(read(f));
      const m = stripped.match(LWC_IMPORT_RE);
      return m ? [`${toRel(f)}:${lineOf(stripped, stripped.indexOf(m[0]))} — ${m[0].trim()}`] : [];
    });
    expect(
      offenders,
      "renderer coupling inside the contract (masterplan law 1: api.ts and canvas/ must " +
      "mirror LWC shapes structurally, never import them — not even for types):\n  " +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("(b) no NEW importer of lightweight-charts appears outside lib/chart-engine (allowlist ratchet)", () => {
    const allow = new Set(LWC_IMPORT_ALLOWLIST);
    const newImporters = EXTERNAL_IMPORTERS.map(toRel).filter((f) => !allow.has(f));
    expect(
      newImporters,
      "new lightweight-charts importers outside lib/chart-engine/ (only lwc/ may touch the " +
      "rented layer; route the code through @/lib/chart-engine instead, or — only if the " +
      "contract genuinely cannot express it yet — justify and extend LWC_IMPORT_ALLOWLIST):\n  " +
      newImporters.join("\n  "),
    ).toEqual([]);

    // A file that went clean is a win, not a failure — but it must be reported so the
    // parent session tightens the allowlist on the next pass (ratchet only closes).
    const importers = new Set(EXTERNAL_IMPORTERS.map(toRel));
    for (const entry of LWC_IMPORT_ALLOWLIST) {
      if (!importers.has(entry)) {
        console.info(
          `[chartEngineBoundary] ${entry} no longer imports lightweight-charts — ` +
          `remove it from LWC_IMPORT_ALLOWLIST to tighten the ratchet.`,
        );
      }
    }
  });

  it("(b) every allowlist entry exists on disk — a stale or misspelled entry fails", () => {
    const stale = LWC_IMPORT_ALLOWLIST.filter(
      (rel) => !existsSync(path.join(TERMINAL_ROOT, rel)),
    );
    expect(
      stale,
      "LWC_IMPORT_ALLOWLIST names files that do not exist (typo, rename, or the importer was " +
      "deleted without tightening the list):\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("(c) // engine-unwrap: tags across lib/chart-engine/** + ChartPanel stay within budget", () => {
    // Counted on RAW source — the tag lives inside a comment, so the stripper must not run.
    const perFile = [ENGINE_FILES, [CHART_PANEL]]
      .flat()
      .filter((f) => existsSync(f))
      .map((f) => ({ file: toRel(f), count: (read(f).match(/engine-unwrap:/g) ?? []).length }))
      .filter((r) => r.count > 0);
    const total = perFile.reduce((n, r) => n + r.count, 0);
    expect(
      total <= ENGINE_UNWRAP_BUDGET,
      `engine-unwrap tag count is ${total}, budget is ${ENGINE_UNWRAP_BUDGET} (masterplan law 2: ` +
      `the escape hatch is grep-countable debt that must reach zero before P3). Per file:\n  ` +
      perFile.map((r) => `${r.file}: ${r.count}`).join("\n  "),
    ).toBe(true);
  });

  it("(d) ChartPanel builds its chart only through createEngine from @/lib/chart-engine", () => {
    const stripped = stripComments(read(CHART_PANEL));
    // Accepts the alias form or a relative specifier that resolves into lib/chart-engine.
    const createEngineImport =
      /import\s*\{[^}]*\bcreateEngine\b[^}]*\}\s*from\s*["'](@\/lib\/chart-engine(?:\/index)?|\.\.\/(?:\.\.\/)?lib\/chart-engine(?:\/index)?)["']/;
    expect(
      createEngineImport.test(stripped),
      "components/ChartPanel.tsx no longer imports createEngine from the chart-engine entry — " +
      "the factory (lib/chart-engine/index.ts) is the single construction point; a direct " +
      "createChart/lightweight-charts call here would bypass the impl flip (P3/P4).",
    ).toBe(true);
  });
});
