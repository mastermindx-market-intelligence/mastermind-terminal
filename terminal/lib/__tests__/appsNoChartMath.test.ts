// Q04 — apps/ carries NO chart math and NO rented renderer.
//
// The native clients (apps/ios) show the Terminal's chart; they must never re-implement it.
// This scan covers EVERY source file under repo-root apps/: TypeScript/JavaScript (.ts/.tsx/.js)
// are parsed with a real AST (the `typescript` package already in devDependencies —
// FunctionDeclaration/MethodDeclaration/VariableDeclaration names, ImportDeclaration
// specifiers, CallExpression callees, and function-body walks), and Swift is scanned with a
// lexer pass that FIRST strips // and /* */ comments (block comments nest in Swift) and
// string literals (so the L10n.swift "Anchored VWAP" dictionary key is stripped code, never
// name-matched), THEN matches declarations (`func|var|let|static func` names) and `import`
// lines. DEVIATION, recorded in RESULT.md: Swift is a lexer scan, not a TS AST.
//
// The rules asserted (all must hold across apps/):
//   1. no import of lightweight-charts / lib/chart-engine / lib/pine-engine or an indicator
//      module — the renderers and math stay in terminal/;
//   2. no `import Charts` (Apple Swift Charts) used for price charts — apps/ios imports only
//      Foundation/SwiftUI/UIKit/WebKit/Security/OSLog today;
//   3. no function/var named like ema|sma|wma|rsi|macd|atr|bollinger|stochastic|vwap|
//      ichimoku (case-insensitive, word-boundary: `ema2`, `RSIValue`, `ema_period` match;
//      `email`/`Avatar` do NOT — a lowercase continuation is not a boundary);
//   4. no candlestick/OHLC drawing: flag a function body that BOTH draws (Path/CGContext
//      addLine / move(to:) / Path{, canvas moveTo/lineTo/fillRect) AND reads OHLC data
//      (`.open/.high/.low/.close/.volume` member access, or iterates an identifier named
//      bars|candles|ohlc|series). Drawing alone is an ICON GLYPH and is fine; reading alone
//      (UIApplication.shared.open(url)) is fine — the AND is the law.
//
// NEGATIVE CONTROLS that must PASS (a scan that flags these is wrong, not the app): the
// icon-glyph Path.addLine shapes at apps/ios/MastermindTerminal/MastermindTerminalApp.
// swift:428, WatchlistScreen.swift:803 and RollerStrip.swift:433, and the L10n string
// literal "Anchored VWAP" in L10n.swift:290 — asserted explicitly in A05/A06.
//
// A01 prints per-extension counts and requires >= 1 file scanned: a scan of nothing is a
// failure, per the task.

import { expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const APPS_ROOT = join(__dirname, "../../../apps");

// ── shared vocabulary ─────────────────────────────────────────────────────────

type SourceFile = { path: string; ext: string; content: string };

type Violation = { file: string; line: number; rule: string; detail: string };

const INDICATOR_TOKENS = ["ema", "sma", "wma", "rsi", "macd", "atr", "bollinger", "stochastic", "vwap", "ichimoku"];

/**
 * "Named like an indicator": the identifier STARTS (case-insensitively) with a token and the
 * token ENDS at a word boundary — end-of-identifier, `_`, a digit, or a NEW camel hump
 * (an uppercase letter). A lowercase continuation means the token is only a prefix of a
 * longer unrelated word, so `email`/`smal` stay honest while `ema2`, `RSIValue`,
 * `ema_period` and `Ichimoku` are flagged.
 */
function isIndicatorName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const tok of INDICATOR_TOKENS) {
    if (!lower.startsWith(tok)) continue;
    if (name.length === tok.length) return true;
    const next = name[tok.length];
    if (next === "_" || next >= "0" && next <= "9" || next >= "A" && next <= "Z") return true;
  }
  return false;
}

/** Module specifiers that must never be imported from apps/. */
const FORBIDDEN_IMPORT = /(lightweight-charts)|(lib\/chart-engine)|(lib\/pine-engine)|(^[.@/\\~-]?)lib\/indicators?(\/|$|\b)|indicators\b|pine-engine\b|chart-engine\b/i;

/** Drawing verbs — SwiftUI Path/CGContext and canvas 2D. */
const DRAW_TOKEN = /\b(addLine|moveTo|lineTo|fillRect|CGContext)\b|\.move\s*\(\s*to\s*:|\bPath\s*[({]/;

/** OHLC member reads (word-bounded: `.close` never matches `closeSubpath()`). */
const OHLC_MEMBER = /\.(open|high|low|close|volume)\b/;

/** OHLC data iteration: a loop/functional pass that reads a bars/candles/ohlc/series name. */
const OHLC_ITER = /\b(?:for|forEach|map|reduce|compactMap|filter|enumerated)\b[^()]{0,220}?\b(?:bars|candles|ohlc|series)\b/i;

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

function listSourceFiles(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".git" || entry === "build" || entry === "DerivedData") continue;
        walk(full);
        continue;
      }
      const ext = entry.endsWith(".tsx") ? "tsx" : entry.endsWith(".ts") ? "ts" : entry.endsWith(".js") ? "js" : entry.endsWith(".swift") ? "swift" : null;
      if (!ext) continue;
      out.push({ path: full, ext, content: readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function bodyDrawsAndReadsOhlc(text: string): boolean {
  return DRAW_TOKEN.test(text) && (OHLC_MEMBER.test(text) || OHLC_ITER.test(text));
}

// ── TypeScript AST pass (.ts / .tsx / .js) ────────────────────────────────────

function scanTsFile(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const kind = file.ext === "js" ? ts.ScriptKind.JS : file.ext === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, kind);
  const report = (offset: number, rule: string, detail: string) => {
    violations.push({ file: file.path, line: lineOf(file.content, offset), rule, detail });
  };
  const walk = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (FORBIDDEN_IMPORT.test(node.moduleSpecifier.text)) {
        report(node.getStart(sf), "forbidden-import", `imports "${node.moduleSpecifier.text}"`);
      }
    }
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const name = node.name ? node.name.getText(sf) : "";
      if (name && isIndicatorName(name)) report(node.getStart(sf), "indicator-name", `function named "${name}"`);
      if (bodyDrawsAndReadsOhlc(node.getText(sf))) {
        report(node.getStart(sf), "ohlc-drawing", `function "${name || "<anonymous>"}" draws AND reads OHLC data`);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (isIndicatorName(name)) report(node.getStart(sf), "indicator-name", `variable named "${name}"`);
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && bodyDrawsAndReadsOhlc(init.getText(sf))) {
        report(node.getStart(sf), "ohlc-drawing", `variable "${name}" holds a function that draws AND reads OHLC data`);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (name && isIndicatorName(name)) report(node.getStart(sf), "indicator-name", `calls "${name}"`);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return violations;
}

// ── Swift lexer pass (.swift) — comments + strings stripped, offsets preserved ─

/**
 * Blank out comments and string literals, preserving every byte offset (stripped characters
 * become spaces; newlines stay). Handles line comments, nested block comments, ordinary strings with
 * `\"`/`\(...)` escapes, and `"""` multi-line strings. Exported for the A06 receipt.
 */
export function stripSwiftCode(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    if (depth > 0) {
      if (src.startsWith("/*", i)) { depth++; blank(i, i + 2); i += 2; continue; }
      if (src.startsWith("*/", i)) { depth--; blank(i, i + 2); i += 2; continue; }
      i += src[i] === "\n" ? 1 : (blank(i, i + 1), 1);
      continue;
    }
    if (src.startsWith("//", i)) {
      let j = i + 2;
      while (j < src.length && src[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (src.startsWith("/*", i)) { depth = 1; blank(i, i + 2); i += 2; continue; }
    if (src[i] === '"') {
      const triple = src.startsWith("\"\"\"", i);
      let j = i + (triple ? 3 : 1);
      for (;;) {
        if (j >= src.length) break;
        if (src[j] === "\\") { j += 2; continue; }
        if (triple ? src.startsWith("\"\"\"", j) : src[j] === '"') { j += triple ? 3 : 1; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join("");
}

/** func-name → brace-balanced body span, found on STRIPPED code (strings/comments can no
 *  longer distort the brace count). The body opener is the first `{` at paren/bracket
 *  depth 0 after the signature. */
function swiftFunctionBodies(stripped: string): { name: string; start: number; end: number }[] {
  const bodies: { name: string; start: number; end: number }[] = [];
  const decl = /\bfunc\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(stripped))) {
    let i = m.index + m[0].length;
    let pdepth = 0;
    for (; i < stripped.length; i++) {
      const c = stripped[i];
      if (c === "(" || c === "[") pdepth++;
      else if (c === ")" || c === "]") pdepth--;
      else if (c === "{" && pdepth === 0) break;
      else if (c === "}" || c === ";") { i = -1; break; } // signature never reached a body
    }
    if (i < 0 || i >= stripped.length || stripped[i] !== "{") continue;
    let depth = 0;
    const start = i;
    for (; i < stripped.length; i++) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    bodies.push({ name: m[1], start, end: i });
  }
  return bodies;
}

function scanSwiftFile(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const stripped = stripSwiftCode(file.content);
  const report = (offset: number, rule: string, detail: string) => {
    violations.push({ file: file.path, line: lineOf(file.content, offset), rule, detail });
  };
  const imp = /^\s*(?:@testable\s+)?import\s+([A-Za-z_][\w.]*)/gm;
  let mi: RegExpExecArray | null;
  while ((mi = imp.exec(stripped))) {
    const mod = mi[1];
    if (mod === "Charts") report(mi.index, "forbidden-import", "imports Apple Swift Charts");
    else if (FORBIDDEN_IMPORT.test(mod)) report(mi.index, "forbidden-import", `imports "${mod}"`);
  }
  const names = /\b(?:static\s+)?(?:func|var|let)\s+([A-Za-z_]\w*)/g;
  let mn: RegExpExecArray | null;
  while ((mn = names.exec(stripped))) {
    if (isIndicatorName(mn[1])) report(mn.index, "indicator-name", `declares "${mn[1]}"`);
  }
  for (const body of swiftFunctionBodies(stripped)) {
    if (bodyDrawsAndReadsOhlc(stripped.slice(body.start, body.end))) {
      report(body.start, "ohlc-drawing", `function "${body.name}" draws AND reads OHLC data`);
    }
  }
  return violations;
}

// ── the scan ──────────────────────────────────────────────────────────────────

type Scan = { files: SourceFile[]; counts: Record<string, number>; violations: Violation[] };

function scanApps(): Scan {
  const files = listSourceFiles(APPS_ROOT);
  const counts: Record<string, number> = {};
  const violations: Violation[] = [];
  for (const f of files) {
    counts[f.ext] = (counts[f.ext] ?? 0) + 1;
    violations.push(...(f.ext === "swift" ? scanSwiftFile(f) : scanTsFile(f)));
  }
  return { files, counts, violations };
}

const scan = scanApps();

it("A01 scans every source file under apps/ and prints the per-extension counts", () => {
  const total = scan.files.length;
  expect(total, "apps/ scan found 0 source files — a scan of nothing is a failure").toBeGreaterThanOrEqual(1);
  const perExt = Object.entries(scan.counts).map(([ext, n]) => `${n} .${ext}`).join(", ");
  console.log(`[appsNoChartMath] scanned ${total} files under apps/: ${perExt}`);
});

it("A02 nothing under apps/ imports rented renderers, lib/chart-engine, lib/pine-engine or indicator modules (incl. `import Charts`)", () => {
  const found = scan.violations.filter((v) => v.rule === "forbidden-import");
  expect(found, `forbidden imports: ${JSON.stringify(found, null, 2)}`).toEqual([]);
});

it("A03 no apps/ function/var/callee is named like an indicator", () => {
  const found = scan.violations.filter((v) => v.rule === "indicator-name");
  expect(found, `indicator-named declarations: ${JSON.stringify(found, null, 2)}`).toEqual([]);
});

it("A04 no apps/ function both draws AND reads OHLC data (candlestick fence)", () => {
  const found = scan.violations.filter((v) => v.rule === "ohlc-drawing");
  expect(found, `OHLC-drawing functions: ${JSON.stringify(found, null, 2)}`).toEqual([]);
});

// ── NEGATIVE CONTROLS: the scan must spare the app's existing honest code ─────

it("A05 the icon-glyph Path.addLine controls are found and stay un-flagged", () => {
  const controls = [
    { file: "MastermindTerminalApp.swift", line: 428, note: "badge glyph: Path.addLine over constant points" },
    { file: "WatchlistScreen.swift", line: 803, note: "mapped chevron glyph: Path.addLine over constant points" },
    { file: "RollerStrip.swift", line: 433, note: "roller glyph: Path.addLine over constant points" },
  ] as const;
  for (const c of controls) {
    const hit = scan.files.find((f) => f.path.endsWith(join("apps", "ios", "MastermindTerminal", c.file)));
    expect(hit, `negative control ${c.file} must exist under apps/`).toBeTruthy();
    const flaggedLine = scan.violations.filter((v) => v.file === hit!.path && v.line === c.line);
    expect(flaggedLine, `${c.file}:${c.line} (${c.note}) must NOT be flagged: ${JSON.stringify(flaggedLine)}`).toEqual([]);
    const flaggedFile = scan.violations.filter((v) => v.file === hit!.path);
    expect(flaggedFile, `${c.file} (${c.note}) must be violation-free`).toEqual([]);
  }
});

it("A06 the lexer strips the L10n \"Anchored VWAP\" string literal before any name matching", () => {
  const l10n = scan.files.find((f) => f.path.endsWith("L10n.swift"));
  expect(l10n, "L10n.swift must exist under apps/ios").toBeTruthy();
  expect(l10n!.content.includes("Anchored VWAP"), 'the real source carries the "Anchored VWAP" literal').toBe(true);
  const stripped = stripSwiftCode(l10n!.content);
  expect(stripped.includes("Anchored VWAP"), "string literals must be gone from the stripped code").toBe(false);
  expect(stripped.includes("VWAP"), 'no "VWAP" survives stripping — identifiers, not words').toBe(false);
  expect(scan.violations.filter((v) => v.file === l10n!.path), "L10n.swift must be violation-free").toEqual([]);
});

it("A07 the name matcher is word-boundary honest: ema2/RSIValue/ema_period match; email/Avatar never do", () => {
  for (const bad of ["ema", "EMA20", "rsiFast", "RSI", "macd", "atr", "VWAP", "ema_period", "Ichimoku", "sma10", "bollingerBand", "atrHeight"]) {
    expect(isIndicatorName(bad), `"${bad}" IS an indicator name`).toBe(true);
  }
  for (const fine of ["email", "Email", "Avatar", "warm", "smal", "path", "seriesMap", "chart", "open", "close", "candlesVisible", "heightRatio"]) {
    expect(isIndicatorName(fine), `"${fine}" must NOT read as an indicator name`).toBe(false);
  }
});
