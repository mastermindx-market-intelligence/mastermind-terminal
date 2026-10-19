import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { planQuoteBatch } from "../quoteDemand";

type Quotes = Record<string, Record<string, unknown> | null>;
const path = join(__dirname, "../../components/TerminalShell.tsx");
const source = readFileSync(path, "utf8");
const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map<string, string>();
let equality = "";
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    initializers.set(node.name.text, node.initializer.getText(parsed));
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "quoteEq") equality = node.getText(parsed);
  ts.forEachChild(node, collect);
}
collect(parsed);

// Execute the actual shell polling callbacks. The state boundary records queued snapshots
// without committing a render, so successive responses must preserve pending publications.
function shellQuotes(initial: Quotes = {}) {
  let response: Quotes = {};
  let pending = initial;
  const queued: Quotes[] = [];
  const context = createContext({
    document: { hidden: false },
    useCallback: (callback: unknown) => callback,
    planQuoteBatch,
    quotePriorityRef: { current: [{ key: "AAPL", symbols: ["AAPL"] }] },
    quoteRotatingRef: { current: [] }, quoteCursorRef: { current: 0 },
    quoteAliveRef: { current: true }, quoteMissRef: { current: {} },
    chartQuoteSymsKeyRef: { current: "AAPL" }, chartQuoteAliveRef: { current: true },
    chartQuoteInFlightRef: { current: false }, chartQuoteTrailingRef: { current: false },
    chartQuoteTrailingTimerRef: { current: null }, publishedQuotesRef: { current: initial },
    fetch: async () => ({ ok: true, json: async () => ({ quotes: response }) }),
    setQuotes: (update: Quotes | ((previous: Quotes) => Quotes)) => {
      pending = typeof update === "function" ? update(pending) : update;
      queued.push(pending);
    },
  });
  const evaluate = (text: string) => runInContext(ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context, { timeout: 1000 });
  evaluate(`const QUOTE_EQ_IGNORE = ${initializers.get("QUOTE_EQ_IGNORE")}; ${equality}`);
  if (initializers.has("updateQuotes")) evaluate(`const updateQuotes = ${initializers.get("updateQuotes")};`);
  for (const name of ["pollQuotes", "pollChartQuotes"]) {
    const initializer = initializers.get(name);
    if (!initializer) throw new Error(`Missing shell callback: ${name}`);
    evaluate(`const ${name} = ${initializer};`);
  }
  return {
    queued,
    async poll(lane: "wide" | "chart", quotes: Quotes) {
      response = quotes;
      evaluate(lane === "wide" ? "pollQuotes();" : "pollChartQuotes();");
      // Drain the real fetch/json/merge/finally promise chain without advancing any timer.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

const apple = { last: 225, basis: "REALTIME", asOfMs: 1000, lagMs: 10 };
describe("Terminal quote publication before React scheduling", () => {
  it.each(["wide", "chart"] as const)("does not enqueue empty %s responses", async (lane) => {
    const shell = shellQuotes();
    await shell.poll(lane, {});
    expect(shell.queued).toEqual([]);
  });

  it("rejects unchanged quotes from both lanes even while a prior publication is pending", async () => {
    const shell = shellQuotes();
    await shell.poll("wide", { AAPL: apple });
    await shell.poll("chart", { AAPL: { ...apple, lagMs: 100 } });
    await shell.poll("wide", { AAPL: { ...apple, lagMs: 200 } });
    expect(shell.queued).toEqual([{ AAPL: apple }]);
  });

  it("merges interleaved changed responses against the latest pending snapshot", async () => {
    const shell = shellQuotes();
    await shell.poll("wide", { AAPL: apple });
    await shell.poll("chart", { MSFT: { last: 400 } });
    await shell.poll("wide", { AAPL: { ...apple, last: 226, asOfMs: 1001 } });
    expect(shell.queued).toEqual([
      { AAPL: apple },
      { AAPL: apple, MSFT: { last: 400 } },
      { AAPL: { ...apple, last: 226, asOfMs: 1001 }, MSFT: { last: 400 } },
    ]);
  });

  it("retains fast-lane misses and evicts only on the third wide-lane miss", async () => {
    const shell = shellQuotes({ AAPL: apple });
    await shell.poll("chart", { AAPL: null });
    await shell.poll("wide", { AAPL: null });
    await shell.poll("wide", { AAPL: null });
    expect(shell.queued).toEqual([]);
    await shell.poll("wide", { AAPL: null });
    expect(shell.queued).toEqual([{}]);
  });

  it("resets the wide-lane miss count on a good unchanged quote", async () => {
    const shell = shellQuotes({ AAPL: apple });
    await shell.poll("wide", { AAPL: null });
    await shell.poll("wide", { AAPL: { ...apple } });
    await shell.poll("wide", { AAPL: null });
    await shell.poll("wide", { AAPL: null });
    expect(shell.queued).toEqual([]);
    await shell.poll("wide", { AAPL: null });
    expect(shell.queued).toEqual([{}]);
  });
});
