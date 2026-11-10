/** theme_rows reader (wire v1.1 §3/§4) — the carried theme performance table.
 *
 * The served typed surface carries `theme_rows` as an ENTRY
 * (`{status, reason?, value}`); this reader takes that entry and returns the
 * rows the theme table renders: one row per theme id in the mapping's own
 * order (consumers never re-sort), the eleven state keys verbatim-typed, and
 * the perf windows (`1d…full`, each `ret`/`rel` when present).
 *
 * Laws (shared with the universe readers, see sectorDepthRows.ts):
 *  • Envelope failures are whole-block `invalid_shape` — no partial table.
 *  • Soft cells never invalidate: a non-finite number reads null, an absent
 *    allow-listed key reads null (rendered "not stated"), unknown window keys
 *    are ignored, and `name`/`name_zh`/`chart_key` read null when the producer
 *    could not source them.
 *  • No `href` exists on this wire — the consumer composes the link from
 *    `chart_key` under the navigable-id law (themeChartHref). A null or
 *    non-conforming chart_key yields no link; nothing is invented.
 *  • The per-theme 21/63-session RS series are NOT carried (no producer
 *    artifact holds them) — that depth stays on the rs_history surface.
 *  • Never throws for any JSON-parsed value (N1: the readers sit behind
 *    JSON.parse; the claim is scoped to what a parsed document can hold, not
 *    to arbitrary JS objects such as cycles or getter-throwing proxies).
 */
import { sameSiteHref } from "./sectorDepthHref";
import {
  classifyEntry,
  conformingChartKey,
  isMapping,
  ownFinite,
  ownNonEmptyString,
  ownOf,
  ownString,
  type RowBlockReason,
} from "./sectorDepthRows";

/** The closed perf-window set (wire §3). */
export type ThemePerfWindow =
  | "1d"
  | "5d"
  | "10d"
  | "20d"
  | "60d"
  | "mtd"
  | "ytd"
  | "full";

const PERF_WINDOWS: readonly ThemePerfWindow[] = [
  "1d",
  "5d",
  "10d",
  "20d",
  "60d",
  "mtd",
  "ytd",
  "full",
];

/** One window's reading: return and vs-benchmark relative return, each null
 * when absent or non-finite (not stated). */
export interface ThemePerfReading {
  ret: number | null;
  rel: number | null;
}

/** The eleven state keys the producer writes tonight, all nullable — an
 * absent key reads null ("not stated"), never a default. */
export interface ThemeRowState {
  label: string | null;
  reco: string | null;
  score: number | null;
  rank: number | null;
  alloc_rank: number | null;
  health: string | null;
  breadth: number | null;
  r10: number | null;
  val_state: string | null;
  days_in_label: number | null;
  score_delta_5d: number | null;
}

export interface ThemeRow {
  id: string;
  name: string | null;
  name_zh: string | null;
  chart_key: string | null;
  state: ThemeRowState;
  /** null when the producer carried no dated perf (no `perf` key); a row's
   * missing window stays absent inside the record. */
  perf: Partial<Record<ThemePerfWindow, ThemePerfReading>> | null;
}

export type ThemeRowsRead =
  | {
      state: "available";
      /** Envelope `as_of` (theme_context.as_of). */
      asOf: string;
      /** The baskets perf date; null when the producer carried no dated
       * baskets.json. Rendered only when it differs from asOf. */
      perfAsOf: string | null;
      rows: ThemeRow[];
    }
  | { state: "unavailable"; reason: RowBlockReason };

function readState(v: unknown): ThemeRowState {
  const src = isMapping(v) ? v : {};
  return {
    label: ownString(src, "label"),
    reco: ownString(src, "reco"),
    score: ownFinite(src, "score") ?? null,
    rank: ownFinite(src, "rank") ?? null,
    alloc_rank: ownFinite(src, "alloc_rank") ?? null,
    health: ownString(src, "health"),
    breadth: ownFinite(src, "breadth") ?? null,
    r10: ownFinite(src, "r10") ?? null,
    val_state: ownString(src, "val_state"),
    days_in_label: ownFinite(src, "days_in_label") ?? null,
    score_delta_5d: ownFinite(src, "score_delta_5d") ?? null,
  };
}

function readPerf(v: unknown): ThemeRow["perf"] {
  if (!isMapping(v)) return null;
  const out: Partial<Record<ThemePerfWindow, ThemePerfReading>> = {};
  for (const window of PERF_WINDOWS) {
    const w = ownOf(v, window);
    if (!isMapping(w)) continue;
    out[window] = {
      ret: ownFinite(w, "ret") ?? null,
      rel: ownFinite(w, "rel") ?? null,
    };
  }
  return out;
}

/** Read the served `theme_rows` typed-block ENTRY (status/reason/value). */
export function themeRowsFromCarriedBlock(entry: unknown): ThemeRowsRead {
  const cls = classifyEntry(entry);
  if (!cls.ok) return { state: "unavailable", reason: cls.reason };
  const value = cls.value;

  const asOf = ownNonEmptyString(value, "as_of");
  if (asOf === null) return { state: "unavailable", reason: "invalid_shape" };
  const perfAsOfRaw = ownOf(value, "perf_as_of");
  const perfAsOf = typeof perfAsOfRaw === "string" && perfAsOfRaw.length > 0 ? perfAsOfRaw : null;

  const rowsRaw = ownOf(value, "rows");
  if (!Array.isArray(rowsRaw)) return { state: "unavailable", reason: "invalid_shape" };
  const rows: ThemeRow[] = [];
  for (const rowRaw of rowsRaw) {
    if (!isMapping(rowRaw)) return { state: "unavailable", reason: "invalid_shape" };
    const id = ownNonEmptyString(rowRaw, "id");
    if (id === null) return { state: "unavailable", reason: "invalid_shape" };
    const stateRaw = ownOf(rowRaw, "state");
    if (stateRaw !== undefined && !isMapping(stateRaw)) {
      return { state: "unavailable", reason: "invalid_shape" };
    }
    const perfRaw = ownOf(rowRaw, "perf");
    if (perfRaw !== undefined && !isMapping(perfRaw)) {
      return { state: "unavailable", reason: "invalid_shape" };
    }
    rows.push({
      id,
      name: ownString(rowRaw, "name"),
      name_zh: ownString(rowRaw, "name_zh"),
      chart_key: ownString(rowRaw, "chart_key"),
      state: readState(stateRaw),
      perf: readPerf(perfRaw),
    });
  }
  return { state: "available", asOf, perfAsOf, rows };
}

/** The detail link composed from `chart_key` under the existing navigable-id
 * law plus the no-`..` refusal — a null, non-conforming or traversal-bearing
 * key yields no link. No href exists on the wire; this is the only composer. */
export function themeChartHref(
  chartKey: string | null | undefined,
): string | undefined {
  if (!conformingChartKey(chartKey)) return undefined;
  return sameSiteHref(`/subsector/${chartKey}.html`) ?? undefined;
}
