// ── Startup timeframe ────────────────────────────────────────────────────────
// The timeframe the Terminal opens on. Ships as 3D; the user can change it in
// Settings → Terminal (the settings panel writes it, TerminalShell reads it at mount).
//
// This lives in its own module rather than in TerminalShell because the settings panel
// renders on EVERY page through AppShell — importing TerminalShell there would
// drag the whole chart bundle onto pages that have no chart.
//
// Persistence matches the rest of the Terminal's local prefs: JSON in localStorage,
// read through the same `load()` idiom (hence JSON.stringify on write).

export const START_TF_KEY = "mm.startTf";
export const DEFAULT_START_TF = "3D";

// Canonical chronological order for every timeframe the Terminal offers. Also the
// sort order for the top-bar favourites tray (TerminalShell.tfSortKey).
// Second band leads the order — it is the finest resolution, and the favourites tray sorts on
// this array's index. US equities only (Massive "Stocks Advanced" entitlement); the picker
// renders them disabled elsewhere, which is why they are canonical but not universally functional.
export const TF_CANONICAL_ORDER = ["1s", "5s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "2h", "4h", "D", "2D", "3D", "W", "2W", "1M", "3M"];

// The daily-derived timeframes the chart can open for EVERY market (TerminalShell's
// DAILY_FUNCTIONAL — intraday is added there only for intraday-capable markets). A caller outside
// the chart bundle that must promise a timeframe before it knows the landing market (the Screener's
// result → chart handover, E01) uses this conservative set. lib/__tests__/terminalTfDeepLink.test.ts
// pins it to the shell's literal so the two cannot drift.
export const DAILY_FUNCTIONAL_TIMEFRAMES: ReadonlySet<string> = new Set(["D", "2D", "3D", "W", "2W", "1M", "3M"]);

// The saved value, sanitized. An unknown/absent/corrupt value reads as the 3D default.
// NOTE: this does NOT check whether the timeframe is functional for a given symbol —
// intraday isn't available on every market. That guard is resolveStartTf, applied by
// TerminalShell at mount; the settings UI deliberately offers the full list.
export function readStartTf(): string {
  try {
    const raw = localStorage.getItem(START_TF_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return typeof v === "string" && TF_CANONICAL_ORDER.includes(v) ? v : DEFAULT_START_TF;
  } catch {
    return DEFAULT_START_TF;
  }
}

export function writeStartTf(tf: string) {
  try { localStorage.setItem(START_TF_KEY, JSON.stringify(tf)); } catch {}
}

// The timeframe the Terminal should actually open on, given the landing symbol's functional
// timeframe set (TerminalShell.functionalSet — daily-derived always, intraday only for
// intraday-capable markets). Two guards, so no saved value can strand a user:
//   • an unknown string → the 3D default;
//   • a timeframe the landing symbol's market can't serve (e.g. 5m on a .TO name) → D.
// `functional` is passed in rather than derived here to keep this module free of the chart
// bundle — TerminalShell owns the one definition of what's functional.
export function resolveStartTf(saved: unknown, functional: ReadonlySet<string>): string {
  const tf = typeof saved === "string" && TF_CANONICAL_ORDER.includes(saved) ? saved : DEFAULT_START_TF;
  return functional.has(tf) ? tf : "D";
}

/**
 * Intervals exposed by the phone's scroll wheel.
 *
 * The wheel is the phone's only timeframe control, so filtering it through the desktop
 * favourites tray strands every unstarred minute/hour interval. Keep favourites as shortcuts;
 * the mobile wheel must carry every interval the active market can actually load. The current
 * value is retained during a symbol transition even if the new market cannot serve it yet, so
 * the controlled wheel never silently jumps to its first row while the chart still shows another.
 */
export function mobileTimeframeOptions(functional: ReadonlySet<string>, current: string): string[] {
  const options = TF_CANONICAL_ORDER.filter((tf) => functional.has(tf));
  if (TF_CANONICAL_ORDER.includes(current) && !options.includes(current)) options.push(current);
  return options.sort((a, b) => TF_CANONICAL_ORDER.indexOf(a) - TF_CANONICAL_ORDER.indexOf(b));
}
