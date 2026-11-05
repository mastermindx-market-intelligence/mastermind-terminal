// @vitest-environment jsdom
/**
 * E20 chart command palette — the action catalog, the stale-selection guard, the keyboard gate
 * and the AC-05 "no new authority" boundary.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIN_PAGES } from "@/components/fin/finPages";
import {
  analysisPageHref,
  buildPaletteActions,
  describePaletteTarget,
  filterPaletteActions,
  groupPaletteActions,
  hasOpenModal,
  isTextEntryElement,
  paletteContextToken,
  resolvePaletteRun,
  shouldOpenPaletteFromKey,
  stepWatchlist,
  type PaletteContext,
} from "@/lib/commandPalette/catalog";
import { COMMAND_PALETTE_LEX, paletteText } from "@/lib/commandPaletteLex";

const ROOT = join(__dirname, "..", "..");

function ctx(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    paneIndex: 0,
    panes: ["NVDA"],
    symbol: "NVDA",
    timeframe: "D",
    researchPage: null,
    tableView: false,
    watchlist: ["BTC-USD", "NVDA", "AAPL"],
    timeframes: [
      { tf: "D", available: true },
      { tf: "W", available: true },
      { tf: "1h", available: false, reason: "Intraday bars aren't available for this symbol" },
    ],
    templates: [],
    indicatorCount: 2,
    drawing: { canUndo: false, canRedo: false },
    replay: { on: false, blocked: null },
    phone: false,
    researchOnAnalysisPage: false,
    review: null,
    ...over,
  };
}

const byId = (c: PaletteContext, id: string, lang: "en" | "zh" = "en") =>
  buildPaletteActions(c, lang).find((a) => a.id === id);

describe("command palette lex", () => {
  it("every string has both an English and a Chinese form", () => {
    for (const [key, pair] of Object.entries(COMMAND_PALETTE_LEX)) {
      expect(pair[0].trim(), `${key} EN`).not.toBe("");
      expect(pair[1].trim(), `${key} ZH`).not.toBe("");
      // Only a pure placeholder line may read the same in both languages.
      if (/[A-Za-z]{2,}/.test(pair[0].replace(/\{\w+\}/g, ""))) expect(pair[1], `${key} is translated`).not.toBe(pair[0]);
    }
  });

  it("fills placeholders and shows an unknown key instead of a blank", () => {
    expect(paletteText("en", "cpTargetChart", { n: 2, sym: "AAPL" })).toBe("Chart 2 · AAPL");
    expect(paletteText("zh", "cpTargetChart", { n: 2, sym: "AAPL" })).toBe("图表 2 · AAPL");
    expect(paletteText("en", "cpNoSuchKey")).toBe("cpNoSuchKey");
  });
});

describe("AC-E20-01: every action names an existing handler and an explicit target", () => {
  it("covers the research pages, timeframes, studies, drawings and watchlist with a target on every row", () => {
    for (const lang of ["en", "zh"] as const) {
      const actions = buildPaletteActions(ctx(), lang);
      expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
      for (const a of actions) {
        expect(a.label.trim(), a.id).not.toBe("");
        expect(a.target.trim(), `${a.id} target`).not.toBe("");
        expect(a.label, `${a.id} has no untranslated key`).not.toMatch(/^cp[A-Z]/);
      }
      for (const page of FIN_PAGES) expect(actions.some((a) => a.id === `research:${page}`)).toBe(true);
    }
  });

  it("only produces the run kinds the shell dispatches, and the shell has a case for each", () => {
    const kinds = new Set(buildPaletteActions(ctx({ templates: [{ id: "t1", name: "Momentum" }] }), "en").map((a) => a.run.kind));
    expect([...kinds].sort()).toEqual([
      "close-research", "drawing-history", "goto-date", "open-indicators", "remove-indicators",
      "replay", "research", "save-template", "symbol", "template", "timeframe",
    ]);
    const shell = readFileSync(join(ROOT, "components/TerminalShell.tsx"), "utf8");
    const block = shell.slice(shell.indexOf("const runPaletteAction"), shell.indexOf("shellCmdRef.current = {"));
    for (const kind of kinds) expect(block, `shell handles ${kind}`).toContain(`case "${kind}":`);
    // Each case calls the visible control's own handler (the falsifier: same state semantics).
    expect(block).toContain("setPaneOpen(run.page)");
    expect(block).toContain("router.push(analysisPageHref(active, run.page))");
    expect(block).toContain("pick(run.symbol)");
    expect(block).toContain("if (FUNCTIONAL.has(run.tf)) setTf(run.tf)");
    expect(block).toContain('new CustomEvent("mm:apply-template"');
    expect(block).toContain('new CustomEvent("mm:save-template")');
    expect(block).toContain("removeAllIndicators()");
    expect(block).toContain("travelDrawingHistory(active, run.direction)");
    expect(block).toContain("toggleReplay()");
    // "Back to chart" runs the research pane's OWN close (its URL cleanup + onClose) instead of a
    // palette copy of it — a copy drifted once already (it missed the transcript-compare keys).
    expect(block).toContain("setResearchCloseRequest((n) => n + 1)");
    expect(block).not.toMatch(/searchParams|replaceState|setPaneOpen\(null\)/);
    expect(shell).toContain("closeRequest={researchCloseRequest}");
    const pane = readFileSync(join(ROOT, "components/fin/MegaPane.tsx"), "utf8");
    const effect = pane.slice(pane.indexOf("const handledCloseRequest"));
    expect(effect.slice(0, effect.indexOf("}, [closePane, closeRequest]);"))).toContain("closePane();");
    // …and it re-checks against the live shell state before anything runs.
    expect(block.indexOf("resolvePaletteRun(")).toBeLessThan(block.indexOf("switch (run.kind)"));
  });

  it("names the chart, the pane count and the timeframe it is acting on", () => {
    expect(describePaletteTarget(ctx(), "en")).toBe("Chart 1 · NVDA · D");
    expect(describePaletteTarget(ctx({ panes: ["NVDA", "AAPL"], paneIndex: 1, symbol: "AAPL" }), "en")).toBe("Chart 2 of 2 · AAPL · D");
    expect(describePaletteTarget(ctx({ researchPage: "statements" }), "zh")).toBe("NVDA 研究 · 报表");
  });

  it("watchlist steps wrap, and say when the next symbol is already open in another chart", () => {
    expect(stepWatchlist(["A", "B", "C"], "C", "next")).toBe("A");
    expect(stepWatchlist(["A", "B", "C"], "A", "previous")).toBe("C");
    expect(stepWatchlist(["A", "A"], "A", "next")).toBeNull();
    expect(byId(ctx(), "watchlist:next")?.target).toBe("Chart 1: NVDA → AAPL");
    const twoUp = ctx({ panes: ["NVDA", "AAPL"] });
    expect(byId(twoUp, "watchlist:next")?.target).toBe("Moves to Chart 2 · AAPL, already open");
  });
});

describe("AC-E20-04: unavailable prerequisites are disabled and explained", () => {
  it("disables each action whose prerequisite is missing, with the reason on the row", () => {
    const c = ctx({ indicatorCount: 0, watchlist: ["NVDA"], phone: true, replay: { on: false, blocked: "multi-chart" } });
    expect(byId(c, "studies:remove-all")?.unavailable).toBe("No studies on the charts");
    expect(byId(c, "template:none")?.unavailable).toMatch(/No saved study templates/);
    expect(byId(c, "drawings:undo")?.unavailable).toBe("No drawing change to undo");
    expect(byId(c, "drawings:redo")?.unavailable).toBe("No drawing change to redo");
    expect(byId(c, "watchlist:next")?.unavailable).toBe("Your watchlist has no other symbol");
    expect(byId(c, "chart:goto-date")?.unavailable).toMatch(/phone/);
    expect(byId(c, "chart:replay")?.unavailable).toMatch(/one chart/);
    expect(byId(c, "tf:D")?.unavailable).toBe("Already the current timeframe");
    // The timeframe menu's own reason is reused verbatim, not paraphrased.
    expect(byId(c, "tf:1h")?.unavailable).toBe("Intraday bars aren't available for this symbol");
    expect(byId(c, "research:close")?.unavailable).toBe("The chart is already showing");
    expect(byId(c, "chart:replay", "zh")?.unavailable).toMatch(/单图/);
  });

  it("refuses to run a disabled action and says why, rather than reporting success", () => {
    const c = ctx({ indicatorCount: 0 });
    const decision = resolvePaletteRun("studies:remove-all", paletteContextToken(c), c, "en");
    expect(decision).toMatchObject({ ok: false, reason: "unavailable", message: "Not available: No studies on the charts" });
    const unknown = resolvePaletteRun("research:nope", paletteContextToken(c), c, "zh");
    expect(unknown).toMatchObject({ ok: false, reason: "gone" });
    const tf = resolvePaletteRun("tf:1h", paletteContextToken(c), c, "en");
    expect(tf.ok).toBe(false);
  });

  it("on touch layouts opens research on the Analysis page, the menu's own destination, and says so", () => {
    const touch = ctx({ researchOnAnalysisPage: true });
    expect(byId(touch, "research:statements")?.target).toBe("For NVDA · opens the Analysis page");
    expect(byId(touch, "research:statements", "zh")?.target).toBe("针对 NVDA · 打开分析页");
    expect(resolvePaletteRun("research:statements", paletteContextToken(touch), touch, "en"))
      .toMatchObject({ ok: true, run: { kind: "research", page: "statements", via: "analysis-page" } });
    expect(analysisPageHref("BRK.B", "statements")).toBe("/analysis?symbol=BRK.B&page=statements");
    expect(analysisPageHref("A&B", "overview")).toBe("/analysis?symbol=A%26B&page=overview");
    // Rotating between layouts while the palette is open is a context change.
    expect(paletteContextToken(touch)).not.toBe(paletteContextToken(ctx()));
  });

  it("runs an available action against the chart it named", () => {
    const c = ctx();
    const decision = resolvePaletteRun("research:statements", paletteContextToken(c), c, "en");
    expect(decision).toMatchObject({ ok: true, run: { kind: "research", page: "statements", via: "pane" } });
    const goto = resolvePaletteRun("chart:goto-date", paletteContextToken(c), c, "en");
    expect(goto).toMatchObject({ ok: true, run: { kind: "goto-date", pane: 0, symbol: "NVDA" } });
  });
});

describe("review session seam (E16 integration point)", () => {
  it("explains that no review session exists instead of guessing a company", () => {
    for (const id of ["review:next", "review:previous"]) {
      const row = byId(ctx(), id);
      expect(row?.group).toBe("watchlist");
      expect(row?.run).toEqual({ kind: "symbol", symbol: "" });
      expect(row?.unavailable).toMatch(/^Review sessions aren't available yet/);
      expect(byId(ctx(), id, "zh")?.unavailable).toMatch(/^复盘会话暂未开放/);
      expect(resolvePaletteRun(id, paletteContextToken(ctx()), ctx(), "en")).toMatchObject({ ok: false, reason: "unavailable" });
    }
  });

  it("steps to the session's own frozen neighbour through the watchlist's symbol handler", () => {
    const c = ctx({ review: { next: "TSLA", previous: null } });
    expect(byId(c, "review:next")).toMatchObject({ unavailable: null, target: "Chart 1: NVDA → TSLA", run: { kind: "symbol", symbol: "TSLA" } });
    // The end of the review is the end — never the watchlist's neighbour as a substitute.
    expect(byId(c, "review:previous")).toMatchObject({ unavailable: "No further item in this review", run: { kind: "symbol", symbol: "" } });
    expect(resolvePaletteRun("review:next", paletteContextToken(c), c, "en")).toMatchObject({ ok: true, run: { kind: "symbol", symbol: "TSLA" } });
  });

  it("offers BOTH frozen neighbours when the session has them (the E16 wiring supplies real ones)", () => {
    const c = ctx({ review: { next: "AAPL", previous: "MSFT" } });
    expect(byId(c, "review:next")).toMatchObject({ unavailable: null, target: "Chart 1: NVDA → AAPL", run: { kind: "symbol", symbol: "AAPL" } });
    expect(byId(c, "review:previous")).toMatchObject({ unavailable: null, target: "Chart 1: NVDA → MSFT", run: { kind: "symbol", symbol: "MSFT" } });
    expect(byId(c, "review:previous", "zh")?.target).toBe("图表 1：NVDA → MSFT");
    expect(resolvePaletteRun("review:previous", paletteContextToken(c), c, "en")).toMatchObject({ ok: true, run: { kind: "symbol", symbol: "MSFT" } });
  });
});

describe("AC-E20-02: a pane or context change invalidates the selection", () => {
  const seen = ctx({ panes: ["NVDA", "AAPL"] });
  const seenToken = paletteContextToken(seen);

  it.each([
    ["the active pane moved", { paneIndex: 1, symbol: "AAPL" }],
    ["the symbol changed", { symbol: "TSLA", panes: ["TSLA", "AAPL"] }],
    ["the timeframe changed", { timeframe: "W" }],
    ["a research page opened", { researchPage: "statements" as const }],
    ["the table view opened", { tableView: true }],
    ["the layout changed", { panes: ["NVDA"] }],
  ])("refuses when %s, and names the new target", (_why, over) => {
    const live = { ...seen, ...over };
    const decision = resolvePaletteRun("watchlist:next", seenToken, live, "en");
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("stale");
    expect(decision.message).toContain(describePaletteTarget(live, "en"));
    // A second, informed confirmation against the live token is what may run.
    if (decision.reason === "stale") {
      const again = resolvePaletteRun("watchlist:next", decision.liveToken, live, "en");
      expect(again.ok || again.reason !== "stale").toBe(true);
    }
  });

  it("does not treat an unrelated re-render as a change", () => {
    const decision = resolvePaletteRun("tf:W", seenToken, { ...seen, indicatorCount: 9, templates: [{ id: "x", name: "y" }] }, "en");
    expect(decision.ok).toBe(true);
  });
});

describe("search", () => {
  it("finds actions by English or Chinese words in either language, label prefixes first", () => {
    const en = buildPaletteActions(ctx(), "en");
    expect(filterPaletteActions(en, "statem")[0].id).toBe("research:statements");
    expect(filterPaletteActions(en, "报表")[0].id).toBe("research:statements");
    expect(filterPaletteActions(en, "earnings").map((a) => a.id)).toContain("research:earnings");
    const zh = buildPaletteActions(ctx(), "zh");
    expect(filterPaletteActions(zh, "statements")[0].id).toBe("research:statements");
    expect(filterPaletteActions(zh, "下一个")[0].id).toBe("watchlist:next");
    expect(filterPaletteActions(en, "zzzz")).toEqual([]);
  });

  it("groups in a fixed order when browsing and in ranked order when searching", () => {
    const en = buildPaletteActions(ctx(), "en");
    expect(groupPaletteActions(en, "en").map((g) => g.id)).toEqual(["research", "chart", "studies", "drawings", "watchlist"]);
    expect(groupPaletteActions(filterPaletteActions(en, "next"), "en", true)[0].id).toBe("watchlist");
  });
});

describe("AC-E20-03: typing, IME composition and open modals never open the palette", () => {
  const body = () => document.body;
  const env = (target: Element | null, modalOpen = false) => ({ target, active: document.body, modalOpen });

  it("opens on a bare > typed on the page", () => {
    expect(shouldOpenPaletteFromKey({ key: ">" }, env(body()))).toBe(true);
  });

  it("ignores other keys, repeats, modifiers and IME composition", () => {
    expect(shouldOpenPaletteFromKey({ key: "." }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", repeat: true }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", metaKey: true }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", ctrlKey: true }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", altKey: true }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", isComposing: true }, env(body()))).toBe(false);
    expect(shouldOpenPaletteFromKey({ key: ">", keyCode: 229 }, env(body()))).toBe(false);
  });

  it("ignores > typed into any text field, editable region or combobox", () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><select id="s"></select>
      <div contenteditable="true"><span id="ce">x</span></div>
      <div role="textbox" id="tb"></div><div role="combobox"><b id="cb">x</b></div>
      <button id="b">ok</button>`;
    for (const id of ["i", "t", "s", "ce", "tb", "cb"]) {
      const el = document.getElementById(id);
      expect(isTextEntryElement(el), id).toBe(true);
      expect(shouldOpenPaletteFromKey({ key: ">" }, env(el)), id).toBe(false);
      // Focus in a field with the event retargeted elsewhere still counts as typing.
      expect(shouldOpenPaletteFromKey({ key: ">" }, { target: document.body, active: el, modalOpen: false }), `${id} active`).toBe(false);
    }
    expect(isTextEntryElement(document.getElementById("b"))).toBe(false);
  });

  it("stays shut while a modal owns the keyboard", () => {
    expect(shouldOpenPaletteFromKey({ key: ">" }, env(body(), true))).toBe(false);
  });

  it("counts only a visible modal dialog as open", () => {
    document.body.innerHTML = `
      <div aria-hidden="true"><div role="dialog" aria-modal="true" id="parked"></div></div>
      <div role="dialog" aria-modal="true" hidden></div>
      <div role="dialog" aria-modal="true" style="visibility:hidden"></div>
      <div inert><div role="dialog" aria-modal="true"></div></div>`;
    expect(hasOpenModal(document)).toBe(false);
    const live = document.createElement("div");
    live.setAttribute("role", "dialog");
    live.setAttribute("aria-modal", "true");
    document.body.appendChild(live);
    expect(hasOpenModal(document)).toBe(true);
  });
});

describe("AC-E20-05: no new queue, context session, script execution or account authority", () => {
  const files = [
    "lib/commandPalette/catalog.ts",
    "lib/commandPaletteLex.ts",
    "components/commandPalette/CommandPalette.tsx",
  ];
  it.each(files)("%s only reads state and calls back into the shell", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const banned of [
      /\bfetch\s*\(/, /\beval\s*\(/, /new\s+Function\b/, /chartBus/i, /WorkspaceContextSession/,
      /localStorage|sessionStorage|indexedDB/, /supabase/i, /\/api\//, /setTimeout|setInterval/,
      /dispatchEvent/, /\bimport\s*\(/, /\b(order|trade|alert|billing|account)s?\b/i,
    ]) {
      expect(src, `${file} must not contain ${banned}`).not.toMatch(banned);
    }
  });
});
