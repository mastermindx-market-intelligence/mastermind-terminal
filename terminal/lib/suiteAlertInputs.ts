/**
 * suiteAlertInputs.ts — the ONE input adapter between a symbol's daily-bar file and the
 * canonical suite-alert evaluator (lib/suiteAlerts.ts).
 *
 * Two callers, one set of input semantics:
 *   • ingest/suite_alerts.ts   — the 5-minute firing sidecar (reads the file, then WRITES fires);
 *   • app/api/alerts/dry-run   — the read-only dry run (reads the file, writes nothing).
 *
 * Both must reach the same decision on the same bytes (AC-E17-01), so neither may grow its own
 * bar parser, module-defaults recipe or creation floor. Everything here is pure except
 * `suiteEventsAtDefaults`, which only awaits the suite's code chunk — it never touches the
 * network, the filesystem or the alert store. Relative imports on purpose: the sidecar is bundled
 * by esbuild from ingest/ (ops/terminal-build.sh).
 */

import { computeSuite, resolveSuiteColors } from "./indicator-canvas/host";
import type { SuiteHostInput } from "./indicator-canvas/host";
import type { SuiteEvent } from "./indicator-canvas/types";
import { suiteDefaults } from "./suites/registry";
import { ensureSuiteRuntime } from "./suites/compute";
import { floorToUtcDayStart, validSuiteBarClock } from "./suiteAlerts";

export interface SuiteSymbolData {
  bars: SuiteHostInput["bars"];
  barsT: number[]; // epoch secs per bar index (UTC midnight of the trading day)
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "YYYY-MM-DD" → epoch secs at UTC midnight; finite numbers pass through; anything else null. */
export function epochOfSuiteDay(t: unknown): number | null {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t !== "string") return null;
  const m = DAY_RE.exec(t);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
}

/**
 * A parsed `<SYM>.json` document ({t,o,src,bars:[["YYYY-MM-DD",o,h,l,c,v],…]}) → the bar rows
 * and their clock. null = unusable: no bars, a malformed row, or a clock that is not strictly
 * increasing. A null is "cannot evaluate", never "no event".
 */
export function parseSuiteDailyBars(doc: unknown): SuiteSymbolData | null {
  const rows: unknown = (doc as { bars?: unknown } | null | undefined)?.bars;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const bars: SuiteHostInput["bars"] = [];
  const barsT: number[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) return null;
    const t = epochOfSuiteDay(r[0]);
    const o = finiteNumber(r[1]);
    const h = finiteNumber(r[2]);
    const l = finiteNumber(r[3]);
    const c = finiteNumber(r[4]);
    const v = finiteNumber(r[5]);
    if (t === null || o === null || h === null || l === null || c === null || v === null) return null;
    bars.push({ time: r[0] as string | number, o, h, l, c, v });
    barsT.push(t);
  }
  return validSuiteBarClock(barsT) ? { bars, barsT } : null;
}

/**
 * Run one suite at MODULE DEFAULTS over the symbol's daily bars and return its merged event
 * stream. Throws only when the suite key has no runtime (callers report "cannot evaluate").
 *
 * The registry is metadata only, so acquire the same runtime graph the chart loads; casting
 * metadata to SuiteDef silently skips every compute and produces an empty tape. Tier "pro" and
 * FALLBACK colors (resolveSuiteColors returns the token fallbacks under Node; events carry no
 * colors). EVERY module is force-enabled — several curated events live in defaultOn:false modules
 * and would otherwise never fire (review W3-1). Settings stay at module defaults.
 *
 * The returned array is computeSuite's memoized bundle: treat it as read-only.
 */
export async function suiteEventsAtDefaults(
  suiteKey: string,
  symbol: string,
  data: SuiteSymbolData,
): Promise<SuiteEvent[]> {
  const def = await ensureSuiteRuntime(suiteKey);
  if (!def) throw new Error(`suite runtime unavailable: "${suiteKey}"`);
  const input: SuiteHostInput = {
    bars: data.bars,
    tf: "D",
    symbol,
    isIntraday: false,
    lang: "en",
    formingBarIndex: null,
    session: "daily",
  };
  const params: Record<string, unknown> = suiteDefaults(suiteKey);
  for (const mod of def.modules) params[`${mod.key}.on`] = true;
  return computeSuite(def, params, input, "pro", resolveSuiteColors()).events;
}

/**
 * The creation floor the firing lane passes to evalSuiteEvent / evalSuiteSequence: the alert's
 * created_at day-floored (so an alert created intraday on day D still sees day-D events), or 0
 * when the stamp is unreadable. Old history never fires on a first evaluation.
 */
export function suiteAlertFloorT(createdAt: unknown): number {
  const createdMs = Date.parse(String(createdAt ?? ""));
  return Number.isFinite(createdMs) ? floorToUtcDayStart(createdMs / 1000) : 0;
}
