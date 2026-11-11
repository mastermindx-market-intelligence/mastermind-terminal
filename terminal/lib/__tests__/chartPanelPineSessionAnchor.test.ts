// ChartPanel must pass the symbol's published session_anchor into every Pine run so nD
// request.security groups on the same grid ChartPanel.resampleTf uses for the chart.
// The engine already accepts RunOpts.sessionAnchor; without it, nD falls back to the
// first-loaded-session grid and names that in a warning (pine-engine/README.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createPineHost } from "../pine-engine/host";
import type { Bar } from "../pine-engine";
import type { SessionAnchor } from "../sessionBars";

// Test-only override so a falsifier can parse a historical ChartPanel.tsx without editing the
// live file. Default is the component ChartPanel.tsx actually ships.
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

// ChartPanel obtains the worker-backed Pine host as:
//   pineHostRef = useRef<PineHost | null>(null)
//   pineHost = () => { pineHostRef.current ??= createPineHost(); return pineHostRef.current }
//   const host = pineHost(); host.run({ ... opts: { ..., sessionAnchor } })
// plus a direct runPine(...) fallback for ORACLE_V1. A new call site must be wired the same
// way and this expected count updated.
const EXPECTED_PINE_RUN_SITES = 2;

type HostBindings = {
  factories: Set<string>;
  values: Set<string>;
  refs: Set<string>;
};

function mentionsCreatePineHost(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (
      ts.isCallExpression(n)
      && ts.isIdentifier(n.expression)
      && n.expression.text === "createPineHost"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function typeMentionsPineHost(type: ts.TypeNode | undefined): boolean {
  return !!type && /\bPineHost\b/.test(type.getText(sourceFile));
}

function collectHostBindings(root: ts.SourceFile): HostBindings {
  const factories = new Set<string>(["createPineHost"]);
  const refs = new Set<string>();
  const values = new Set<string>();

  const pass1 = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const init = node.initializer;
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && mentionsCreatePineHost(init)) {
        factories.add(name);
      }
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "useRef") {
        const typeArg = init.typeArguments?.[0];
        if (typeMentionsPineHost(node.type) || typeMentionsPineHost(typeArg)) refs.add(name);
      }
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isCallExpression(node.right)
      && ts.isIdentifier(node.right.expression)
      && node.right.expression.text === "createPineHost"
    ) {
      if (
        ts.isPropertyAccessExpression(node.left)
        && node.left.name.text === "current"
        && ts.isIdentifier(node.left.expression)
      ) {
        refs.add(node.left.expression.text);
      } else if (ts.isIdentifier(node.left)) {
        values.add(node.left.text);
      }
    }
    ts.forEachChild(node, pass1);
  };
  pass1(root);

  const pass2 = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && factories.has(init.expression.text)) {
        values.add(node.name.text);
      }
      if (
        ts.isPropertyAccessExpression(init)
        && init.name.text === "current"
        && ts.isIdentifier(init.expression)
        && refs.has(init.expression.text)
      ) {
        values.add(node.name.text);
      }
    }
    ts.forEachChild(node, pass2);
  };
  pass2(root);

  return { factories, values, refs };
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  while (
    ts.isParenthesizedExpression(cur)
    || ts.isAsExpression(cur)
    || ts.isTypeAssertionExpression(cur)
    || ts.isNonNullExpression(cur)
    || ts.isAwaitExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function isPineHostReceiver(expr: ts.Expression, bindings: HostBindings): boolean {
  const inner = unwrap(expr);
  if (ts.isIdentifier(inner) && bindings.values.has(inner.text)) return true;
  if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && bindings.factories.has(inner.expression.text)) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(inner)
    && inner.name.text === "current"
    && ts.isIdentifier(inner.expression)
    && bindings.refs.has(inner.expression.text)
  ) {
    return true;
  }
  return false;
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => {
    if (
      ts.isPropertyAssignment(p)
      || ts.isShorthandPropertyAssignment(p)
      || ts.isMethodDeclaration(p)
    ) {
      if (p.name && ts.isIdentifier(p.name)) return p.name.text === name;
      if (p.name && ts.isStringLiteral(p.name)) return p.name.text === name;
    }
    return false;
  });
}

type PineRunSite = {
  kind: "runPine" | "host.run";
  call: ts.CallExpression;
  options: ts.ObjectLiteralExpression | undefined;
};

function findPineRunSites(root: ts.SourceFile): PineRunSite[] {
  const bindings = collectHostBindings(root);
  const sites: PineRunSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "runPine") {
        const opts = node.arguments[2];
        sites.push({
          kind: "runPine",
          call: node,
          options: opts && ts.isObjectLiteralExpression(opts) ? opts : undefined,
        });
      } else if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "run"
        && isPineHostReceiver(node.expression.expression, bindings)
      ) {
        const arg0 = node.arguments[0];
        let options: ts.ObjectLiteralExpression | undefined;
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          const optsProp = propertyNamed(arg0, "opts");
          if (optsProp && ts.isPropertyAssignment(optsProp) && ts.isObjectLiteralExpression(optsProp.initializer)) {
            options = optsProp.initializer;
          }
        }
        sites.push({ kind: "host.run", call: node, options });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return sites;
}

const HTF_HOLIDAYS = new Set(["2025-01-20", "2025-02-17"]);
function tradingDays(from: string, to: string): Bar[] {
  const out: Bar[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t);
    const time = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || HTF_HOLIDAYS.has(time)) continue;
    const i = out.length;
    const c = 100 + ((i * 7) % 13) + i * 0.1;
    out.push({ time, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i });
  }
  return out;
}

const BARS = tradingDays("2025-01-02", "2025-04-15");
const SRC = `//@version=6
indicator("anchored")
plot(request.security(syminfo.tickerid, "3D", close), "x")
`;

async function hostPlot(opts: { sessionAnchor?: SessionAnchor | null } = {}) {
  const h = createPineHost();
  const out = await h.run({
    slot: "nd-anchor",
    source: SRC,
    bars: BARS,
    opts: { timeframe: "D", symbol: "TEST", ...opts },
  });
  h.dispose();
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  expect(out.result).toBeTruthy();
  return {
    x: out.result!.plots[0].data.map((p) => p.value),
    warnings: out.result!.warnings,
  };
}

describe("ChartPanel Pine runs pass the published session anchor", () => {
  it("every runPine and Pine-host .run call site passes sessionAnchor on its options object", () => {
    const sites = findPineRunSites(sourceFile);
    expect(
      sites,
      "ChartPanel Pine run sites (host.run + runPine); a new call site must pass sessionAnchor and this count must be updated",
    ).toHaveLength(EXPECTED_PINE_RUN_SITES);

    const kinds = sites.map((s) => s.kind).sort();
    expect(kinds).toEqual(["host.run", "runPine"]);

    for (const site of sites) {
      expect(
        site.options,
        `${site.kind} must pass an object-literal options bag so sessionAnchor can be checked`,
      ).toBeDefined();
      const prop = propertyNamed(site.options!, "sessionAnchor");
      expect(
        prop,
        `${site.kind} options object must have a sessionAnchor property: ${site.call.getText(sourceFile)}`,
      ).toBeDefined();
    }
  });

  it("an nD request at the host boundary groups on a cloned published anchor and emits no fallback warning; omitting it reproduces the warning", async () => {
    const m = 3, a = 1;
    const published: SessionAnchor = { v: 1, date: BARS[10].time, index: 10 + a, basis: "ipo" };
    // Worker postMessage structured-clones opts; the published object must survive that copy.
    const cloned = structuredClone(published);
    expect(cloned).toEqual(published);

    const withAnchor = await hostPlot({ sessionAnchor: cloned });
    const without = await hostPlot({});

    expect(without.warnings.some((w) => w.includes("'3D'") && w.includes("no session anchor")), JSON.stringify(without.warnings)).toBe(true);
    expect(withAnchor.warnings.filter((w) => w.includes("session anchor") || w.includes("feed-phase")), JSON.stringify(withAnchor.warnings)).toEqual([]);
    expect(withAnchor.x, "the published anchor must change the nD grid").not.toEqual(without.x);

    // Independent reference: global index of row i is i+a; a group closes when (i+a)%m===0.
    const of: number[] = [];
    const last: number[] = [];
    let g = -1;
    for (let i = 0; i < BARS.length; i++) {
      if (i === 0 || (i - 1 + a) % m === 0) g++;
      of.push(g);
      last[g] = i;
    }
    const closed = last.map((l) => (l + a) % m === 0);
    const htfClose: number[] = [];
    BARS.forEach((b, i) => { htfClose[of[i]] = b.c; });
    withAnchor.x.forEach((v, i) => {
      const grp = of[i];
      const publishedIdx = closed[grp] && i >= last[grp] ? grp : grp - 1;
      if (publishedIdx < 0) expect(v, `na @${i}`).toBeUndefined();
      else expect(v, `anchored 3D @${i}`).toBeCloseTo(htfClose[publishedIdx], 9);
    });
  });
});
