/**
 * Chart command palette — the bounded action catalog (E20).
 *
 * The palette is a second way to reach controls that already exist on the chart screen. It owns
 * no state of its own beyond what the person is typing: every action here names an existing shell
 * handler (`PaletteRun`), is derived from a snapshot of the shell's CURRENT state
 * (`PaletteContext`), and carries the human-readable target it will change. Nothing in this module
 * executes anything, stores anything, or talks to the network — TerminalShell executes a resolved
 * run through the same owner its visible button uses.
 *
 * Staleness: `paletteContextToken` fingerprints the chart the person is looking at (active chart,
 * chart count and order, symbol, timeframe, research page / table view). The palette remembers the
 * token it last showed; `resolvePaletteRun` refuses a run whose token no longer matches, so a pane
 * switch between "looked at the row" and "pressed Enter" can never apply the action to a chart the
 * row did not name.
 */
import { FIN_PAGES, type FinPage } from "@/components/fin/finPages";
import { PALETTE_PAGE_TEXT, palettePageLabel, paletteText, type PaletteLang } from "@/lib/commandPaletteLex";

export type PaletteGroupId = "research" | "chart" | "studies" | "drawings" | "watchlist";
export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = ["research", "chart", "studies", "drawings", "watchlist"];
const GROUP_LABEL_KEY: Record<PaletteGroupId, string> = {
  research: "cpGroupResearch",
  chart: "cpGroupChart",
  studies: "cpGroupStudies",
  drawings: "cpGroupDrawings",
  watchlist: "cpGroupWatchlist",
};

export interface PaletteTimeframeOption {
  tf: string;
  /** Whether the shell's own timeframe control would accept it (its FUNCTIONAL set). */
  available: boolean;
  /** The shell's own localized reason when it would not (same text as the timeframe menu). */
  reason?: string;
}

/** What the chart screen is showing right now. Built by TerminalShell from its own state. */
export interface PaletteContext {
  /** Index of the active chart in `panes`. */
  paneIndex: number;
  /** Symbol per chart, in layout order. */
  panes: readonly string[];
  /** Active chart's symbol and timeframe. */
  symbol: string;
  timeframe: string;
  /** Research page replacing the chart body, or null when the chart is showing. */
  researchPage: FinPage | null;
  /** The table view replaces the chart body. */
  tableView: boolean;
  /** Symbols the phone symbol wheel rotates through: the active watchlist (+ the charted symbol). */
  watchlist: readonly string[];
  timeframes: readonly PaletteTimeframeOption[];
  templates: readonly { id: string; name: string }[];
  /** Built-in studies + enabled scripts — what "remove all" would remove. */
  indicatorCount: number;
  drawing: { canUndo: boolean; canRedo: boolean };
  replay: { on: boolean; blocked: "multi-chart" | "no-data" | null };
  /** Phone layout: the in-chart range row (and its go-to-date control) is not rendered. */
  phone: boolean;
  /**
   * Touch layouts (≤860px): research opens on the Analysis page — where the menu's Analysis link
   * goes, with its own "Back to chart" — instead of the chart's research pane, which covers the
   * whole screen there and has no way back to the chart.
   */
  researchOnAnalysisPage: boolean;
  /**
   * Optional integration seam for a watchlist review session (program item E16): the session's
   * frozen previous/next company. Null when no review session is running, and the review rows then
   * say so instead of guessing a company. When a review is running, the shell runs the rows through
   * the review owner's own next()/prev(), which advance the itinerary and navigate through `pick`;
   * a null neighbour is the end of the review, never a substitute.
   */
  review: { next: string | null; previous: string | null } | null;
}

/** The closed set of things the palette can ask the shell to do. No free-form command, no code. */
export type PaletteRun =
  | { kind: "research"; page: FinPage; via: "pane" | "analysis-page" }
  | { kind: "close-research" }
  | { kind: "symbol"; symbol: string }
  | { kind: "timeframe"; tf: string }
  | { kind: "template"; id: string }
  | { kind: "save-template" }
  | { kind: "open-indicators" }
  | { kind: "remove-indicators" }
  | { kind: "drawing-history"; direction: "undo" | "redo" }
  | { kind: "replay" }
  | { kind: "goto-date"; pane: number; symbol: string };

export interface PaletteAction {
  /** Stable for the same action across rebuilds (used to re-find it after a context change). */
  id: string;
  group: PaletteGroupId;
  label: string;
  /** What the action changes, in words — always shown. */
  target: string;
  run: PaletteRun;
  /** Why it cannot run right now; null when it can. */
  unavailable: string | null;
  /** Lower-cased search text in BOTH languages, so either language finds the action. */
  haystack: string;
}

export function paletteContextToken(ctx: PaletteContext): string {
  const view = ctx.researchPage ? `research:${ctx.researchPage}` : ctx.tableView ? "table" : "chart";
  const research = ctx.researchOnAnalysisPage ? "analysis-page" : "pane";
  return [ctx.paneIndex, ctx.panes.join(","), ctx.symbol, ctx.timeframe, view, research].join("|");
}

/** The Analysis page for one company page — the same route the menu's Analysis link opens. */
export function analysisPageHref(symbol: string, page: FinPage): string {
  return `/analysis?symbol=${encodeURIComponent(symbol)}&page=${encodeURIComponent(page)}`;
}

function chartLabel(ctx: PaletteContext, lang: PaletteLang): string {
  const n = ctx.paneIndex + 1;
  return ctx.panes.length > 1
    ? paletteText(lang, "cpTargetChartOf", { n, count: ctx.panes.length, sym: ctx.symbol })
    : paletteText(lang, "cpTargetChart", { n, sym: ctx.symbol });
}

/** The one-line description of what the palette is acting on (shown in its header). */
export function describePaletteTarget(ctx: PaletteContext, lang: PaletteLang): string {
  if (ctx.researchPage) {
    return paletteText(lang, "cpTargetResearch", { sym: ctx.symbol, page: palettePageLabel(lang, ctx.researchPage) });
  }
  return paletteText(lang, "cpTargetChartTf", { chart: chartLabel(ctx, lang), tf: ctx.timeframe });
}

const both = (key: string, vars?: Record<string, string | number>) =>
  `${paletteText("en", key, vars)} ${paletteText("zh", key, vars)}`;

export function buildPaletteActions(ctx: PaletteContext, lang: PaletteLang): PaletteAction[] {
  const out: PaletteAction[] = [];
  const chart = chartLabel(ctx, lang);
  const add = (a: Omit<PaletteAction, "haystack">, extra: string) => {
    out.push({ ...a, haystack: `${a.label} ${extra}`.toLowerCase() });
  };

  // ── Research: the same page switch the research navigation performs ──
  add({
    id: "research:close",
    group: "research",
    label: paletteText(lang, "cpBackToChart"),
    target: chart,
    run: { kind: "close-research" },
    unavailable: ctx.researchPage ? null : paletteText(lang, "cpWhyChartShowing"),
  }, `${both("cpBackToChart")} ${both("cpGroupChart")}`);
  for (const page of FIN_PAGES) {
    const text = PALETTE_PAGE_TEXT[page];
    const pageLabel = palettePageLabel(lang, page);
    add({
      id: `research:${page}`,
      group: "research",
      label: paletteText(lang, "cpOpenPage", { page: pageLabel }),
      target: paletteText(lang, ctx.researchOnAnalysisPage ? "cpTargetForAnalysis" : "cpTargetFor", { sym: ctx.symbol }),
      run: { kind: "research", page, via: ctx.researchOnAnalysisPage ? "analysis-page" : "pane" },
      unavailable: ctx.researchPage === page ? paletteText(lang, "cpWhyAlreadyOpen") : null,
    }, `${text.label.join(" ")} ${text.alias.join(" ")} ${both("cpGroupResearch")} ${ctx.symbol}`);
  }

  // ── Chart: timeframe (the timeframe menu's own guard), go to date, Bar Replay ──
  for (const option of ctx.timeframes) {
    const current = option.tf === ctx.timeframe;
    add({
      id: `tf:${option.tf}`,
      group: "chart",
      label: paletteText(lang, "cpTimeframe", { tf: option.tf }),
      target: chart,
      run: { kind: "timeframe", tf: option.tf },
      unavailable: current
        ? paletteText(lang, "cpWhyCurrentTf")
        : option.available ? null : (option.reason || paletteText(lang, "cpUnavailableTag")),
    }, `${both("cpTimeframe", { tf: option.tf })} interval tf`);
  }
  add({
    id: "chart:goto-date",
    group: "chart",
    label: paletteText(lang, "cpGotoDate"),
    target: chart,
    run: { kind: "goto-date", pane: ctx.paneIndex, symbol: ctx.symbol },
    unavailable: ctx.phone
      ? paletteText(lang, "cpWhyGotoPhone")
      : ctx.researchPage ? paletteText(lang, "cpWhyGotoResearch")
      : ctx.tableView ? paletteText(lang, "cpWhyGotoTable")
      : null,
  }, `${both("cpGotoDate")} jump calendar`);
  const replayChart = ctx.panes[0] ?? ctx.symbol;
  add({
    id: "chart:replay",
    group: "chart",
    label: paletteText(lang, ctx.replay.on ? "cpReplayExit" : "cpReplayStart"),
    target: paletteText(lang, "cpTargetChart", { n: 1, sym: replayChart }),
    run: { kind: "replay" },
    unavailable: ctx.replay.on || !ctx.replay.blocked ? null
      : ctx.replay.blocked === "multi-chart" ? paletteText(lang, "cpWhyReplayMulti")
      : paletteText(lang, "cpWhyReplayNoData"),
  }, `${both("cpReplayStart")} ${both("cpReplayExit")} replay`);

  // ── Studies: the indicator dialog, the template menu's apply/save events, remove-all ──
  if (ctx.templates.length) {
    for (const template of ctx.templates) {
      add({
        id: `template:${template.id}`,
        group: "studies",
        label: paletteText(lang, "cpApplyTemplate", { name: template.name }),
        target: paletteText(lang, "cpTargetAllCharts"),
        run: { kind: "template", id: template.id },
        unavailable: null,
      }, `${both("cpApplyTemplateNone")} ${template.name} template`);
    }
  } else {
    add({
      id: "template:none",
      group: "studies",
      label: paletteText(lang, "cpApplyTemplateNone"),
      target: paletteText(lang, "cpTargetAllCharts"),
      run: { kind: "template", id: "" },
      unavailable: paletteText(lang, "cpWhyNoTemplates"),
    }, `${both("cpApplyTemplateNone")} template`);
  }
  add({
    id: "studies:save-template",
    group: "studies",
    label: paletteText(lang, "cpSaveTemplate"),
    target: paletteText(lang, "cpTargetAllCharts"),
    run: { kind: "save-template" },
    unavailable: null,
  }, `${both("cpSaveTemplate")} template`);
  add({
    id: "studies:open",
    group: "studies",
    label: paletteText(lang, "cpOpenIndicators"),
    target: paletteText(lang, "cpTargetAllCharts"),
    run: { kind: "open-indicators" },
    unavailable: null,
  }, `${both("cpOpenIndicators")} indicator indicators`);
  add({
    id: "studies:remove-all",
    group: "studies",
    label: paletteText(lang, "cpRemoveIndicators"),
    target: paletteText(lang, "cpTargetAllChartsUndo"),
    run: { kind: "remove-indicators" },
    unavailable: ctx.indicatorCount > 0 ? null : paletteText(lang, "cpWhyNoStudies"),
  }, `${both("cpRemoveIndicators")} indicators clear`);

  // ── Drawings: the toolbar's undo/redo, scoped to the active symbol's drawings ──
  const drawings = paletteText(lang, "cpTargetDrawings", { sym: ctx.symbol });
  add({
    id: "drawings:undo",
    group: "drawings",
    label: paletteText(lang, "cpDrawUndo"),
    target: drawings,
    run: { kind: "drawing-history", direction: "undo" },
    unavailable: ctx.drawing.canUndo ? null : paletteText(lang, "cpWhyNothingToUndo"),
  }, both("cpDrawUndo"));
  add({
    id: "drawings:redo",
    group: "drawings",
    label: paletteText(lang, "cpDrawRedo"),
    target: drawings,
    run: { kind: "drawing-history", direction: "redo" },
    unavailable: ctx.drawing.canRedo ? null : paletteText(lang, "cpWhyNothingToRedo"),
  }, both("cpDrawRedo"));

  // ── Watchlist: the phone symbol wheel's step (shell `pick`), next/previous ──
  const symbolTarget = (to: string | null) => {
    const openAt = to ? ctx.panes.findIndex((sym) => sym === to) : -1;
    return !to ? chart
      : openAt >= 0 && openAt !== ctx.paneIndex ? paletteText(lang, "cpTargetFocus", { n: openAt + 1, sym: to })
      : paletteText(lang, "cpTargetSwap", { n: ctx.paneIndex + 1, from: ctx.symbol, to });
  };
  for (const direction of ["next", "previous"] as const) {
    const to = stepWatchlist(ctx.watchlist, ctx.symbol, direction);
    add({
      id: `watchlist:${direction}`,
      group: "watchlist",
      label: paletteText(lang, direction === "next" ? "cpNextSymbol" : "cpPrevSymbol"),
      target: symbolTarget(to),
      run: { kind: "symbol", symbol: to ?? "" },
      unavailable: to ? null : paletteText(lang, "cpWhyNoOtherSymbol"),
    }, `${both(direction === "next" ? "cpNextSymbol" : "cpPrevSymbol")} ${to ?? ""}`);
  }
  // Review session (seam, see `PaletteContext.review`): its frozen neighbour, or an explanation.
  for (const direction of ["next", "previous"] as const) {
    const key = direction === "next" ? "cpNextReview" : "cpPrevReview";
    const to = ctx.review ? ctx.review[direction] : null;
    add({
      id: `review:${direction}`,
      group: "watchlist",
      label: paletteText(lang, key),
      target: symbolTarget(to),
      run: { kind: "symbol", symbol: to ?? "" },
      unavailable: !ctx.review ? paletteText(lang, "cpWhyNoReview")
        : to ? null : paletteText(lang, "cpWhyReviewEdge"),
    }, `${both(key)} review ${to ?? ""}`);
  }
  return out;
}

/** The neighbour of `symbol` in the watchlist, wrapping; null when there is no OTHER symbol. */
export function stepWatchlist(list: readonly string[], symbol: string, direction: "next" | "previous"): string | null {
  const unique = list.filter((s, i) => s && list.indexOf(s) === i);
  if (unique.length < 2) return null;
  const at = unique.indexOf(symbol);
  if (at < 0) return direction === "next" ? unique[0] : unique[unique.length - 1];
  const step = direction === "next" ? 1 : -1;
  return unique[(at + step + unique.length) % unique.length];
}

/** Every whitespace-separated query word must appear; label-prefix matches sort first. */
export function filterPaletteActions(actions: readonly PaletteAction[], query: string): PaletteAction[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...actions];
  const hits = actions.filter((a) => words.every((w) => a.haystack.includes(w)));
  const first = words[0];
  const rank = (a: PaletteAction) => (a.label.toLowerCase().startsWith(first) ? 0 : a.label.toLowerCase().includes(first) ? 1 : 2);
  return hits
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}

export function groupPaletteActions(actions: readonly PaletteAction[], lang: PaletteLang, ordered = false) {
  if (ordered) {
    // Keep the ranked order: one run of rows per group, groups in first-hit order.
    const groups: { id: PaletteGroupId; label: string; actions: PaletteAction[] }[] = [];
    for (const a of actions) {
      let g = groups.find((x) => x.id === a.group);
      if (!g) { g = { id: a.group, label: paletteText(lang, GROUP_LABEL_KEY[a.group]), actions: [] }; groups.push(g); }
      g.actions.push(a);
    }
    return groups;
  }
  return PALETTE_GROUP_ORDER
    .map((id) => ({ id, label: paletteText(lang, GROUP_LABEL_KEY[id]), actions: actions.filter((a) => a.group === id) }))
    .filter((g) => g.actions.length > 0);
}

export type PaletteRunDecision =
  | { ok: true; run: PaletteRun; action: PaletteAction }
  | { ok: false; reason: "stale"; message: string; liveToken: string }
  | { ok: false; reason: "unavailable" | "gone"; message: string };

/**
 * Decide whether `actionId`, chosen while the palette showed `seenToken`, may run against the
 * LIVE context. Refuses (never re-targets) on any context change, a vanished action, or an
 * unavailable prerequisite — the caller shows `message` instead of pretending something happened.
 */
export function resolvePaletteRun(actionId: string, seenToken: string, live: PaletteContext, lang: PaletteLang): PaletteRunDecision {
  const liveToken = paletteContextToken(live);
  const actions = buildPaletteActions(live, lang);
  const action = actions.find((a) => a.id === actionId);
  if (liveToken !== seenToken) {
    return {
      ok: false,
      reason: "stale",
      liveToken,
      message: action
        ? paletteText(lang, "cpStale", { target: describePaletteTarget(live, lang), action: action.label })
        : paletteText(lang, "cpStaleNoAction", { target: describePaletteTarget(live, lang) }),
    };
  }
  if (!action) return { ok: false, reason: "gone", message: paletteText(lang, "cpGone") };
  if (action.unavailable) return { ok: false, reason: "unavailable", message: paletteText(lang, "cpUnavailable", { why: action.unavailable }) };
  return { ok: true, run: action.run, action };
}

// ── Opening the palette from the keyboard ─────────────────────────────────────────────────────

export interface PaletteKeyLike {
  key: string;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** True for any element a keystroke is meant to type into. */
export function isTextEntryElement(el: Element | null | undefined): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  return typeof node.closest === "function" && !!node.closest("[contenteditable='true'],[contenteditable=''],[role='textbox'],[role='combobox']");
}

/**
 * Whether a modal surface currently owns the keyboard. A dialog that is parked hidden (inside an
 * `aria-hidden`/`inert` subtree, `hidden`, or not displayed) does not count — the Brain widget,
 * for one, keeps an invisible inspector dialog in the page at all times.
 */
export function hasOpenModal(root: ParentNode): boolean {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[aria-modal='true']"))) {
    if (el.hidden || el.closest("[aria-hidden='true'], [inert], [hidden]")) continue;
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) continue;
    return true;
  }
  return false;
}

/**
 * ">" opens the palette only when the person is not typing anywhere, no IME composition is in
 * progress, no modifier is held (so no browser/OS or ⌥ chart shortcut is shadowed), it is not a
 * key-repeat, and no modal surface (symbol search, a dialog, a sheet) currently owns the keyboard.
 */
export function shouldOpenPaletteFromKey(
  e: PaletteKeyLike,
  env: { target: Element | null; active: Element | null; modalOpen: boolean },
): boolean {
  if (e.key !== ">") return false;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (env.modalOpen) return false;
  if (isTextEntryElement(env.target) || isTextEntryElement(env.active)) return false;
  return true;
}
