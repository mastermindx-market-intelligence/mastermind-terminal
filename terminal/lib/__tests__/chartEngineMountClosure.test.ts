// P04-A01 — ChartPanel runtime import-closure fence.
//
// Computes the RUNTIME (value-edge) static import closure of components/ChartPanel.tsx with the
// `typescript` compiler API (devDependency; the ts-AST pattern mirrors appsNoChartMath.test.ts)
// and fences that inside the closure the ONLY file importing "lightweight-charts" or "fancy-canvas"
// (in ANY import kind — type-only included) is lib/chart-engine/lwc/index.ts. The renderer import
// stays quarantined in the adapter; everything the chart actually *runs* on stays renderer-free.
//
// Walker contract (implemented exactly per the task design):
//   * Resolution: "@/x" -> TERMINAL_ROOT/x; "./" / "../" -> relative to the importing file.
//     Candidates, first existing FILE wins:
//       [p, p.ts, p.tsx, p.js, p.mjs, p/index.ts, p/index.tsx]
//     Bare specifiers (node_modules packages) are NOT followed and are NOT "unresolved"; a
//     relative/alias specifier that resolves to nothing lands in `unresolved` as
//     "<spec> in <relFile>". Non-code targets (.css/.json/.svg/...) are skipped — never parsed.
//   * Value edges (followed): ImportDeclaration (side-effect imports included) UNLESS
//     `importClause.isTypeOnly`, or the clause has no default name, no namespace import and
//     NamedImports with >=1 element where EVERY element is type-only; ExportDeclaration with a
//     moduleSpecifier UNLESS isTypeOnly or all-type-only NamedExports ("export * from" IS an
//     edge); dynamic `import("x")` and `require("x")` with a string-literal argument.
//   * NOT a value edge: ImportTypeNode (`let a: import("./x").T`) — a pure type position.
//   * LWC detection, per file IN the closure: ANY ImportDeclaration / ExportDeclaration /
//     ImportTypeNode / dynamic import / require — type-only INCLUDED — whose specifier matches
//     /^(lightweight-charts|fancy-canvas)(\/|$)/. AST-based, so comments and string literals can
//     never count.
//
// Tests: R1..R3 run on the REAL tree (they are the fence); M1..M9 run the walker against
// in-memory virtual trees and prove each edge rule in BOTH directions (negative cases of the
// walker itself), so the fence cannot be satisfied by a walker that simply follows everything or
// nothing.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const TERMINAL_ROOT = path.resolve(__dirname, "..", "..");

/** lightweight-charts / fancy-canvas (root or deep) — any kind of reference counts here. */
const LWC_RE = /^(lightweight-charts|fancy-canvas)(\/|$)/;

/** Targets with these extensions are imported but never parsed and never part of the closure. */
const NON_CODE_EXTENSIONS = new Set([
  ".css", ".scss", ".sass", ".less",
  ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp",
  ".mp3", ".mp4", ".webm", ".wav", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".md", ".mdx", ".txt", ".csv", ".yaml", ".yml", ".toml", ".xml", ".html",
  ".glsl", ".wgsl", ".wasm",
]);

type Host = {
  readFile(abs: string): string | undefined;
  fileExists(abs: string): boolean;
};

type ClosureResult = {
  /** absolute paths of every file in the runtime (value-edge) closure */
  files: Set<string>;
  /** TERMINAL_ROOT-relative, "/"-separated, sorted */
  lwcImporters: string[];
  /** "<spec> in <relFile>" strings, TERMINAL_ROOT-relative, "/"-separated */
  unresolved: string[];
};

const realHost: Host = {
  readFile(abs) {
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  },
  fileExists(abs) {
    try {
      return fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  },
};

function rel(abs: string): string {
  return path.relative(TERMINAL_ROOT, abs).split(path.sep).join("/");
}

function scriptKindFor(abs: string): ts.ScriptKind {
  const ext = path.extname(abs).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function isCodeTarget(abs: string): boolean {
  return !NON_CODE_EXTENSIONS.has(path.extname(abs).toLowerCase());
}

/** String literal of a specifier position: "x", or a LiteralTypeNode wrapping "x" (import type). */
function stringSpecText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return node.literal.text;
  return null;
}

/** `import ...` clause kinds that pull the target into the RUNTIME closure. */
function isValueImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true; // side-effect import "x" — a value edge
  if (clause.isTypeOnly) return false;
  if (clause.name) return true; // default name present -> runtime binding
  const bindings = clause.namedBindings;
  if (!bindings) return true;
  if (ts.isNamespaceImport(bindings)) return true; // import * as ns from "x"
  // NamedImports: only type-only specifiers (and at least one) -> erased at runtime.
  return !(bindings.elements.length >= 1 && bindings.elements.every((e) => e.isTypeOnly));
}

/** `export ... from "x"` forms that pull the target into the RUNTIME closure. */
function isValueExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (!node.moduleSpecifier) return false; // local `export { a }` — no target at all
  if (node.isTypeOnly) return false; // export type * from "x"
  const bindings = node.exportClause;
  if (bindings && ts.isNamedExports(bindings)) {
    return !(bindings.elements.length >= 1 && bindings.elements.every((e) => e.isTypeOnly));
  }
  return true; // export * from "x", export * as ns from "x", export { v } from "x"
}

/** Every import-like edge in a parsed file: value edges, plus every specifier of ANY kind. */
function collectEdges(sf: ts.SourceFile): { valueSpecs: string[]; anySpecs: string[] } {
  const valueSpecs: string[] = [];
  const anySpecs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = stringSpecText(node.moduleSpecifier);
      if (spec !== null) {
        anySpecs.push(spec);
        if (isValueImportDeclaration(node)) valueSpecs.push(spec);
      }
    } else if (ts.isExportDeclaration(node)) {
      const spec = stringSpecText(node.moduleSpecifier);
      if (spec !== null) {
        anySpecs.push(spec);
        if (isValueExportDeclaration(node)) valueSpecs.push(spec);
      }
    } else if (ts.isImportTypeNode(node)) {
      // TYPE position: counted for LWC detection, never a value edge.
      const spec = stringSpecText(node.argument);
      if (spec !== null) anySpecs.push(spec);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const spec = stringSpecText(node.arguments[0]);
        if (spec !== null) {
          anySpecs.push(spec);
          valueSpecs.push(spec);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { valueSpecs, anySpecs };
}

/**
 * Resolve a value-edge specifier from `importerAbs` to an absolute path.
 * Returns the target path, or null for a bare (package) specifier / failed resolution.
 * Failed relative/alias resolutions are appended to `unresolved` as "<spec> in <relFile>".
 */
function resolveToAbsolute(spec: string, importerAbs: string, host: Host, unresolved: string[]): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = path.join(TERMINAL_ROOT, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(importerAbs), spec);
  } else {
    return null; // bare package specifier: never followed
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (host.fileExists(candidate)) return candidate;
  }
  unresolved.push(`${spec} in ${rel(importerAbs)}`);
  return null;
}

/**
 * BFS of the runtime closure of `entryAbs` through `host`. `files` holds absolute paths;
 * a file counts as an lwcImporter iff it is IN the closure and ANY import-like node in it
 * (type-only included) names lightweight-charts or fancy-canvas.
 */
function walkValueClosure(entryAbs: string, host: Host): ClosureResult {
  const files = new Set<string>();
  const lwcReached = new Set<string>();
  const unresolved: string[] = [];
  const queue: string[] = [entryAbs];
  while (queue.length > 0) {
    const abs = queue.shift();
    if (abs === undefined) break;
    if (files.has(abs)) continue;
    const text = host.readFile(abs);
    if (text === undefined) continue; // no bytes to parse — nothing to follow
    files.add(abs);
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
    const edges = collectEdges(sf);
    if (edges.anySpecs.some((s) => LWC_RE.test(s))) lwcReached.add(abs);
    for (const spec of edges.valueSpecs) {
      const target = resolveToAbsolute(spec, abs, host, unresolved);
      if (target === null) continue;
      if (!isCodeTarget(target)) continue; // style/data/asset import: skipped, not parsed
      if (!files.has(target)) queue.push(target);
    }
  }
  return { files, lwcImporters: [...lwcReached].map(rel).sort(), unresolved };
}

/** Same LWC detector, pointed at ONE real-tree file (regardless of closure membership). */
function importsRendererAny(relFile: string, host: Host): boolean {
  const abs = path.join(TERMINAL_ROOT, ...relFile.split("/"));
  const text = host.readFile(abs);
  if (text === undefined) throw new Error(`importsRendererAny: cannot read ${relFile}`);
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
  return collectEdges(sf).anySpecs.some((s) => LWC_RE.test(s));
}

// ── in-memory host machinery for the M1..M9 walker mutants ─────────────────────
// Virtual files live under TERMINAL_ROOT so "@/" resolution behaves exactly like the real tree.

function memHost(vfiles: Record<string, string>): Host {
  const map = new Map<string, string>();
  for (const [relFile, text] of Object.entries(vfiles)) {
    map.set(path.join(TERMINAL_ROOT, ...relFile.split("/")), text);
  }
  return {
    readFile: (abs) => map.get(abs),
    fileExists: (abs) => map.has(abs),
  };
}

const V_ENTRY = path.join(TERMINAL_ROOT, "components", "Entry.tsx");

function closureOf(entryText: string, vfiles: Record<string, string>): ClosureResult & { relFiles: string[] } {
  const result = walkValueClosure(V_ENTRY, memHost({ "components/Entry.tsx": entryText, ...vfiles }));
  return { ...result, relFiles: [...result.files].map(rel).sort() };
}

// ── the tests ──────────────────────────────────────────────────────────────────

describe("ChartPanel runtime closure (P04-A01)", () => {
  const CHART_PANEL_ABS = path.join(TERMINAL_ROOT, "components", "ChartPanel.tsx");

  // Computed once; R1/R2/R3 only read it.
  const realClosure = walkValueClosure(CHART_PANEL_ABS, realHost);
  const realRelFiles = new Set([...realClosure.files].map(rel));

  it("R1 — real tree: lib/chart-engine/lwc/index.ts is the ONLY closure file importing lightweight-charts/fancy-canvas, nothing unresolved", () => {
    expect(realClosure.lwcImporters).toEqual(["lib/chart-engine/lwc/index.ts"]);
    expect(realClosure.unresolved).toEqual([]);
  });

  it("R2 — real tree closure is non-vacuous: chart math + adapters are inside it, size >= FLOOR", () => {
    // Measured once at BASE_SHA 367f488e5c67d0871d4a34c2aa7371f327d44c3d: the value closure
    // of components/ChartPanel.tsx spans SIZE = 197 files. FLOOR = Math.floor(0.8 * 197) = 157
    // tolerates a 20% shrinkage (tree trims) but catches any walker that stops following real
    // edges.
    const FLOOR = 157; // measured 197 at BASE_SHA
    for (const needed of [
      "lib/chartTimeAxis.ts",
      "lib/sessionShading.ts",
      "lib/chart-engine/lwc/index.ts",
      "lib/chart-engine/api.ts",
    ]) {
      expect(realRelFiles.has(needed), `closure should contain ${needed}`).toBe(true);
    }
    expect(realClosure.files.size).toBeGreaterThanOrEqual(FLOOR);
  });

  it("R3 — lib/chartTimeAxis.ts and lib/sessionShading.ts each import lightweight-charts/fancy-canvas in NO kind", () => {
    expect(importsRendererAny("lib/chartTimeAxis.ts", realHost)).toBe(false);
    expect(importsRendererAny("lib/sessionShading.ts", realHost)).toBe(false);
  });

  it("M1 — value import edge: a followed file's lightweight-charts import is caught", () => {
    const res = closureOf(`import { a } from "./a";\nexport const use = () => a;\n`, {
      "components/a.ts": `import { x } from "lightweight-charts";\nexport const a = x;\n`,
    });
    expect(res.lwcImporters).toEqual(["components/a.ts"]);
    expect(res.relFiles).toContain("components/a.ts");
  });

  it("M2 — `import type` is NOT a value edge: the type-only target never enters the closure", () => {
    const res = closureOf(`import type { T } from "./b";\nexport type U = T;\n`, {
      "components/b.ts": `import { Chart } from "lightweight-charts";\nexport type T = number;\n`,
    });
    expect(res.relFiles).not.toContain("components/b.ts");
    expect(res.lwcImporters).toEqual([]);
  });

  it("M3 — every named specifier type-only (`import { type T }`) is NOT a value edge", () => {
    const res = closureOf(`import { type T } from "./c";\nexport type U = T;\n`, {
      "components/c.ts": `import { createChart } from "lightweight-charts";\nexport type T = number;\n`,
    });
    expect(res.relFiles).not.toContain("components/c.ts");
    expect(res.lwcImporters).toEqual([]);
  });

  it("M4 — a mixed clause (`import { type T, v }`) IS a value edge: the target joins the closure and its LWC import is caught", () => {
    const res = closureOf(`import { type T, v } from "./d";\nexport const use = () => v as T;\n`, {
      "components/d.ts": `import { createChart } from "lightweight-charts";\nexport type T = number;\nexport const v = 1;\n`,
    });
    expect(res.relFiles).toContain("components/d.ts");
    expect(res.lwcImporters).toEqual(["components/d.ts"]);
  });

  it("M5 — `export { v } from` is followed; `export type { T } from` is not", () => {
    const res = closureOf(`export { v } from "./e";\nexport type { T } from "./f";\n`, {
      "components/e.ts": `export const v = 1;\n`,
      "components/f.ts": `export type T = string;\n`,
    });
    expect(res.relFiles).toContain("components/e.ts");
    expect(res.relFiles).not.toContain("components/f.ts");
  });

  it("M6 — dynamic `import('x')` is followed; `import('x').T` in a TYPE position is not", () => {
    const res = closureOf(
      `const m = import("./g");\nexport const use = () => m;\nlet h: import("./h").T;\nexport const hh = () => h;\n`,
      {
        "components/g.ts": `export const g = 1;\n`,
        "components/h.ts": `export type T = number;\n`,
      },
    );
    expect(res.relFiles).toContain("components/g.ts");
    expect(res.relFiles).not.toContain("components/h.ts");
  });

  it("M7 — a value-reached file's TYPE-ONLY renderer imports still make it an lwcImporter (lightweight-charts AND fancy-canvas)", () => {
    const res = closureOf(`import { m } from "./m";\nimport { n } from "./n";\nexport const use = () => [m, n];\n`, {
      "components/m.ts": `import type { Time } from "lightweight-charts";\nexport type MT = Time;\nexport const m = 1;\n`,
      "components/n.ts": `import type { CanvasRenderingTarget2D } from "fancy-canvas";\nexport type NT = CanvasRenderingTarget2D;\nexport const n = 2;\n`,
    });
    expect(res.relFiles).toContain("components/m.ts");
    expect(res.relFiles).toContain("components/n.ts");
    expect(res.lwcImporters).toEqual(["components/m.ts", "components/n.ts"]);
  });

  it("M8 — @/ alias resolves to TERMINAL_ROOT, directory imports hit index.ts, and a commented-out renderer import does NOT count", () => {
    const res = closureOf(`import { k } from "@/lib/k";\nimport { i } from "./dir";\nexport const use = () => [k, i];\n`, {
      "lib/k.ts": `// import { x } from "lightweight-charts"\nconst mention = "import { y } from 'fancy-canvas'";\nexport const k = mention;\n`,
      "components/dir/index.ts": `export const i = 2;\n`,
    });
    expect(res.relFiles).toContain("lib/k.ts");
    expect(res.relFiles).toContain("components/dir/index.ts");
    expect(res.lwcImporters).toEqual([]);
  });

  it("M9 — a dangling relative specifier is reported as unresolved, '<spec> in <relFile>', once", () => {
    const res = closureOf(`import { z } from "./missing";\nexport const use = () => z;\n`, {});
    expect(res.unresolved).toEqual(["./missing in components/Entry.tsx"]);
  });
});
