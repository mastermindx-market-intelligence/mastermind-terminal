// ── `/terminal?tf=` deep link (E01 chart handover, AC-E01-05) ─────────────────
// A Screener result opens `/terminal?sym=<SYM>&tf=<TF>` (lib/technicalScan.technicalChartHandover).
// The Terminal has exactly one timeframe pathway for an outside caller — the `mm:set-tf` seam the
// intraday "Back to Daily" overlay and the native shell bridge already use, guarded inside
// TerminalShell by the active symbol's functional set. This module owns only the pure decisions;
// components/TerminalTfDeepLink.tsx applies them once the chart has announced its first frame.
//
// It never writes `mm.startTf`: opening one result must not change the user's startup setting.

import { canonicalChartSymbol } from "./terminalBoot";
import { TF_CANONICAL_ORDER } from "./startTf";

export const TF_DEEP_LINK_PARAM = "tf";

export type TfDeepLink = {
  /** The canonical timeframe the link asks for. */
  tf: string;
  /** canonicalChartSymbol(`sym`), or null when the link names no (valid) symbol. */
  symbol: string | null;
};

/** Read the link. Only a canonical timeframe string counts; anything else is no request. */
export function readTfDeepLink(search: string): TfDeepLink | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return null; }
  const tf = params.get(TF_DEEP_LINK_PARAM);
  if (tf === null || !TF_CANONICAL_ORDER.includes(tf)) return null;
  return { tf, symbol: canonicalChartSymbol(params.get("sym")) };
}

/**
 * Decide what to do with the chart's first announced frame. Returns the timeframe to dispatch on
 * `mm:set-tf`, or null when nothing should change:
 *   • the announcement is for another symbol (a previous chart's late frame) → wait (`"wait"`);
 *   • the chart already shows the requested timeframe → null (no second load);
 *   • otherwise → the requested timeframe.
 */
export function tfDeepLinkTarget(link: TfDeepLink, announced: { symbol?: unknown; timeframe?: unknown }): string | null | "wait" {
  if (link.symbol !== null && canonicalChartSymbol(announced.symbol) !== link.symbol) return "wait";
  return announced.timeframe === link.tf ? null : link.tf;
}

/** The URL with the one-shot `tf` removed (the shell strips its own one-shot params the same way). */
export function stripTfDeepLink(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.searchParams.has(TF_DEEP_LINK_PARAM)) return null;
    u.searchParams.delete(TF_DEEP_LINK_PARAM);
    return u.toString();
  } catch { return null; }
}
