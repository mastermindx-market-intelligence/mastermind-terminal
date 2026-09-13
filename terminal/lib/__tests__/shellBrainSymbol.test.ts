// Review ruling (PR #490, MAJOR 2): AppShell must never mount BrainWidget with an empty
// active symbol — a cold /analysis load opened through the external floating launcher (which
// never calls the in-app "attach exact source" handoff, so `__MM_BRAIN_ACTIVE_SYMBOL__` is
// never written) left `cfg.symbol()` returning "" forever. resolveShellBrainSymbol is the
// pure resolution AppShell now runs on every /analysis entry: route param -> last active
// chart-workspace pane (localStorage "mm.ws") -> the shell default. Tested directly here
// (no DOM/React involved) plus once more at the BrainWidget integration layer in
// brainWidgetColdSymbol.test.ts.
//
// Plain Node environment, no jsdom: this repo's vitest jsdom environment does not provide a
// real window.localStorage (confirmed: `typeof window.localStorage === "undefined"` under
// `@vitest-environment jsdom` here), so resolveShellBrainSymbol takes the narrow
// `ShellBrainSymbolHost` shape (location.href + a getItem-capable store) specifically so a
// plain in-memory stub can stand in for it — see lib/shellBrainSymbol.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  resolveShellBrainSymbol,
  announceShellBrainSymbol,
  subscribeShellBrainSymbol,
  SHELL_DEFAULT_BRAIN_SYMBOL,
  SHELL_BRAIN_SYMBOL_EVENT,
  type ShellBrainSymbolHost,
  type ShellBrainSymbolBroadcastHost,
  type ShellBrainSymbolListenHost,
} from "@/lib/shellBrainSymbol";
import { ANALYSIS_DEFAULT_SYMBOL } from "@/lib/analysisSymbol";

function makeHost(href: string, mmWs?: unknown): ShellBrainSymbolHost {
  const store = new Map<string, string>();
  if (mmWs !== undefined) store.set("mm.ws", typeof mmWs === "string" ? mmWs : JSON.stringify(mmWs));
  return {
    location: { href },
    localStorage: { getItem: (key: string) => (store.has(key) ? store.get(key)! : null) },
  };
}

describe("resolveShellBrainSymbol", () => {
  it("never resolves to an empty string", () => {
    expect(resolveShellBrainSymbol(makeHost("https://mastermind-x.com/analysis"))).not.toBe("");
  });

  it("falls back to the shell default when there is no route param and no stored workspace", () => {
    expect(resolveShellBrainSymbol(makeHost("https://mastermind-x.com/analysis"))).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);
  });

  it("prefers the route's own ?symbol= query param", () => {
    const host = makeHost("https://mastermind-x.com/analysis?symbol=aapl", { panes: ["MSFT"], activePane: 0 });
    expect(resolveShellBrainSymbol(host)).toBe("AAPL");
  });

  it("falls back to the chart workspace's last active pane when there is no route param", () => {
    const host = makeHost("https://mastermind-x.com/analysis", { panes: ["TSLA", "MSFT"], activePane: 1 });
    expect(resolveShellBrainSymbol(host)).toBe("MSFT");
  });

  it("clamps an out-of-range activePane to the first stored pane instead of throwing", () => {
    const host = makeHost("https://mastermind-x.com/analysis", { panes: ["TSLA"], activePane: 7 });
    expect(resolveShellBrainSymbol(host)).toBe("TSLA");
  });

  it("ignores a malformed ?symbol= value and falls through to the store, never crashing", () => {
    const host = makeHost(
      "https://mastermind-x.com/analysis?symbol=" + encodeURIComponent("not a symbol"),
      { panes: ["NFLX"], activePane: 0 },
    );
    expect(resolveShellBrainSymbol(host)).toBe("NFLX");
  });

  it("ignores a corrupt mm.ws payload and falls back to the default, never throwing", () => {
    const host = makeHost("https://mastermind-x.com/analysis", "{not json");
    expect(() => resolveShellBrainSymbol(host)).not.toThrow();
    expect(resolveShellBrainSymbol(host)).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);
  });

  it("returns the shell default when the host is unavailable (SSR)", () => {
    expect(resolveShellBrainSymbol(undefined)).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);
  });
});

describe("AppShell wires BrainWidget's active prop to useShellBrainSymbol (regression guard for the exact reviewer-cited bug site)", () => {
  const APP_SHELL_TSX = readFileSync(join(__dirname, "..", "..", "components", "chrome", "AppShell.tsx"), "utf8");

  it("no longer mounts BrainWidget with the literal empty-string active prop", () => {
    expect(APP_SHELL_TSX).not.toMatch(/<BrainWidget\s+active=""/);
  });

  it("imports useShellBrainSymbol and passes its result as BrainWidget's active prop", () => {
    // Review round-4: a plain useMemo(() => resolveShellBrainSymbol(), [path]) never re-ran on
    // a same-route symbol switch (AnalysisWorkspace rewrites ?symbol= with
    // history.replaceState, which triggers no re-render) — see MAJOR-1 above and
    // useShellBrainSymbol's own test in the next describe block.
    expect(APP_SHELL_TSX).toMatch(/import\s*\{\s*useShellBrainSymbol\s*\}\s*from\s*["']@\/lib\/shellBrainSymbol["']/);
    const assignment = APP_SHELL_TSX.match(/const\s+(\w+)\s*=\s*useShellBrainSymbol\(/);
    expect(assignment, "no useShellBrainSymbol(...) assignment found").not.toBeNull();
    const localName = assignment![1];
    const activeProp = APP_SHELL_TSX.match(/<BrainWidget\s+active=\{(\w+)\}/);
    expect(activeProp, "<BrainWidget active={...}> prop not found").not.toBeNull();
    expect(activeProp![1]).toBe(localName);
  });
});

describe("announceShellBrainSymbol / subscribeShellBrainSymbol (review round-4, MAJOR 1 — the channel useShellBrainSymbol uses to stay live)", () => {
  // A minimal in-memory EventTarget stub — same host-injection pattern as makeHost() above —
  // so this suite needs no jsdom `window` (plain Node's global EventTarget/CustomEvent, used
  // directly here, is what the real browser window satisfies structurally too).
  function makeEventHost(): ShellBrainSymbolBroadcastHost & ShellBrainSymbolListenHost & EventTarget {
    return new EventTarget() as ShellBrainSymbolBroadcastHost & ShellBrainSymbolListenHost & EventTarget;
  }

  it("delivers an announced symbol to a subscriber", () => {
    const host = makeEventHost();
    const received: string[] = [];
    subscribeShellBrainSymbol((s) => received.push(s), host);

    announceShellBrainSymbol("AAPL", host);

    expect(received).toEqual(["AAPL"]);
  });

  it("drops a malformed symbol instead of broadcasting it", () => {
    const host = makeEventHost();
    const received: string[] = [];
    subscribeShellBrainSymbol((s) => received.push(s), host);

    announceShellBrainSymbol("not a symbol", host);

    expect(received).toEqual([]);
  });

  it("stops delivering after unsubscribe", () => {
    const host = makeEventHost();
    const received: string[] = [];
    const unsubscribe = subscribeShellBrainSymbol((s) => received.push(s), host);

    unsubscribe();
    announceShellBrainSymbol("MSFT", host);

    expect(received).toEqual([]);
  });

  it("is a no-op (never throws) with no host, on either side", () => {
    expect(() => announceShellBrainSymbol("AAPL", undefined)).not.toThrow();
    expect(() => subscribeShellBrainSymbol(() => undefined, undefined)()).not.toThrow();
  });

  it("uses one well-known event name both sides agree on", () => {
    const host = makeEventHost();
    let sawEvent = false;
    host.addEventListener(SHELL_BRAIN_SYMBOL_EVENT, () => { sawEvent = true; });
    announceShellBrainSymbol("AAPL", host);
    expect(sawEvent).toBe(true);
  });
});

describe("SHELL_DEFAULT_BRAIN_SYMBOL cannot drift from AnalysisWorkspace's own default (review ruling, PR #490 MINOR: default symbol)", () => {
  // Before this fix, lib/shellBrainSymbol.ts and components/workspaces/AnalysisWorkspace.tsx
  // each declared their own `"NVDA"` literal — nothing would catch one changing without the
  // other. Both now derive from lib/analysisSymbol.ts's ANALYSIS_DEFAULT_SYMBOL.
  //
  // Review round 6, MINOR 4: the value check below (`SHELL_DEFAULT_BRAIN_SYMBOL` `toBe`
  // `ANALYSIS_DEFAULT_SYMBOL`) can never go red on its own — `SHELL_DEFAULT_BRAIN_SYMBOL` is a
  // plain re-export (`export const SHELL_DEFAULT_BRAIN_SYMBOL = ANALYSIS_DEFAULT_SYMBOL;`), so
  // the two names are the same value by construction; only re-introducing a second literal in
  // shellBrainSymbol.ts's own source — which a value-equality check on the two constants, being
  // identical either way, cannot see — would ever separate them. The two source-scan tests
  // below are the actual guards, one per file, each pinning "derived by reference" over
  // "re-declared as a literal" the same way AnalysisWorkspace.tsx's was already pinned.
  it("SHELL_DEFAULT_BRAIN_SYMBOL is exactly lib/analysisSymbol.ts's ANALYSIS_DEFAULT_SYMBOL (documents intent; see the source-scan tests below for the real guard)", () => {
    expect(SHELL_DEFAULT_BRAIN_SYMBOL).toBe(ANALYSIS_DEFAULT_SYMBOL);
  });

  it("lib/shellBrainSymbol.ts's SHELL_DEFAULT_BRAIN_SYMBOL is derived from ANALYSIS_DEFAULT_SYMBOL, not a re-declared literal", () => {
    const SHELL_BRAIN_SYMBOL_TS = readFileSync(join(__dirname, "..", "shellBrainSymbol.ts"), "utf8");
    expect(SHELL_BRAIN_SYMBOL_TS).toMatch(
      /import\s*\{[^}]*\bANALYSIS_DEFAULT_SYMBOL\b[^}]*\}\s*from\s*["']\.\/analysisSymbol["']/,
    );
    expect(SHELL_BRAIN_SYMBOL_TS).toMatch(
      /export\s+const\s+SHELL_DEFAULT_BRAIN_SYMBOL\s*=\s*ANALYSIS_DEFAULT_SYMBOL\s*;/,
    );
    expect(SHELL_BRAIN_SYMBOL_TS).not.toMatch(/export\s+const\s+SHELL_DEFAULT_BRAIN_SYMBOL\s*=\s*["']NVDA["']/);
  });

  it("AnalysisWorkspace.tsx's DEFAULT_SYMBOL is derived from ANALYSIS_DEFAULT_SYMBOL, not a re-declared literal", () => {
    const ANALYSIS_WORKSPACE_TSX = readFileSync(
      join(__dirname, "..", "..", "components", "workspaces", "AnalysisWorkspace.tsx"),
      "utf8",
    );
    expect(ANALYSIS_WORKSPACE_TSX).toMatch(
      /import\s*\{[^}]*\bANALYSIS_DEFAULT_SYMBOL\b[^}]*\}\s*from\s*["']@\/lib\/analysisSymbol["']/,
    );
    expect(ANALYSIS_WORKSPACE_TSX).toMatch(/const\s+DEFAULT_SYMBOL\s*=\s*ANALYSIS_DEFAULT_SYMBOL\s*;/);
    expect(ANALYSIS_WORKSPACE_TSX).not.toMatch(/const\s+DEFAULT_SYMBOL\s*=\s*["']NVDA["']/);
  });
});
