// Data OS U02 — ChartPanel's data-origin seam, as a TypeScript AST check over the
// component source (the chartPanelPineSessionAnchor.test.ts pattern). The contract:
// exactly four emissions, every one AFTER its branch's epoch guard, a callback ref that
// never enters a dependency array, and the daily emission derived from the accepted
// OHLC document itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Test-only override so a falsifier can parse a historical ChartPanel.tsx without editing
// the live file. Default is the component ChartPanel.tsx actually ships.
function chartPanelSourcePath(): string {
  const override = process.env.CHARTPANEL_SRC;
  if (override && override.length > 0) return path.resolve(override);
  return path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx");
}

const sourceText = readFileSync(chartPanelSourcePath(), "utf8");
const sourceFile = ts.createSourceFile(
  "ChartPanel.tsx",
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const EMIT_CALL = "onDataOriginRef.current";

type EmitSite = { call: ts.CallExpression; argText: string };

function collectEmitSites(root: ts.Node): EmitSite[] {
  const sites: EmitSite[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sourceFile) === EMIT_CALL) {
      sites.push({ call: n, argText: n.arguments.map((a) => a.getText(sourceFile)).join(", ") });
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return sites;
}

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
    || ts.isMethodDeclaration(n);
}

// True when `block` contains (without crossing another function boundary) an
// `if (... epochRef.current !== epoch ...) return;` guard.
function blockHasEpochGuard(block: ts.Block): boolean {
  let guarded = false;
  const scan = (n: ts.Node) => {
    if (isFunctionLike(n)) return;   // a nested function's guards are not ours
    if (ts.isIfStatement(n) && /epochRef\.current\s*!==\s*epoch/.test(n.expression.getText(sourceFile))) {
      let returns = false;
      const findReturn = (r: ts.Node) => {
        if (ts.isReturnStatement(r)) { returns = true; return; }
        ts.forEachChild(r, findReturn);
      };
      findReturn(n.thenStatement);
      if (returns) { guarded = true; return; }
    }
    ts.forEachChild(n, scan);
  };
  scan(block);
  return guarded;
}

// The emission must sit in its own block, or an enclosing block of the SAME function,
// that carries the epoch guard — i.e. climbing from the call to its innermost enclosing
// function body, some Block on the way guards with `epochRef.current !== epoch`.
function precededByEpochGuard(site: ts.CallExpression): boolean {
  let current: ts.Node = site.parent;
  const blocks: ts.Block[] = [];
  while (current) {
    if (ts.isBlock(current)) blocks.push(current);
    if (isFunctionLike(current)) break;   // reached the function that owns the call; stop
    current = current.parent;
  }
  return blocks.some((b) => blockHasEpochGuard(b));
}

describe("ChartPanel data-origin seam", () => {
  const sites = collectEmitSites(sourceFile);

  it("emits the derived origin at exactly four points", () => {
    expect(sites).toHaveLength(4);
  });

  it("every emission follows its branch's epoch guard (a superseded generation stays silent)", () => {
    for (const site of sites) {
      expect(precededByEpochGuard(site.call)).toBe(true);
    }
  });

  it("onDataOrigin / onDataOriginRef appear in no hook dependency array", () => {
    const offenders: string[] = [];
    const walk = (n: ts.Node) => {
      if (
        ts.isCallExpression(n)
        && ts.isIdentifier(n.expression)
        && ["useEffect", "useLayoutEffect", "useCallback", "useMemo"].includes(n.expression.text)
      ) {
        const deps = n.arguments[1];
        if (deps && ts.isArrayLiteralExpression(deps)) {
          for (const el of deps.elements) {
            const text = el.getText(sourceFile);
            if (text === "onDataOrigin" || text === "onDataOriginRef") offenders.push(`${n.expression.text} deps: ${text}`);
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sourceFile);
    expect(offenders).toEqual([]);
  });

  it("the daily emission derives from the accepted OHLC document: deriveDataOrigin(symbol, ohlc)", () => {
    expect(sites.map((s) => s.argText)).toContain("deriveDataOrigin(symbol, ohlc)");
  });

  it("the other three emissions are the intraday/composite/unavailable constructors", () => {
    const args = sites.map((s) => s.argText).filter((a) => a !== "deriveDataOrigin(symbol, ohlc)");
    expect(args.sort()).toEqual([
      'originNotCovered(symbol, "INTRADAY_NOT_IN_V1")',
      "originComposite(symbol)",
      "originUnavailable(symbol)",
    ].sort());
  });
});
