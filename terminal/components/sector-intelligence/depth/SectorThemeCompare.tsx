"use client";
/**
 * SectorThemeCompare — the retained theme/compare/history controls (lane 7,
 * deliverable c). Everything here reads ONE admitted source: the selected
 * native generation's sector rotation history (rs_21d / rs_63d series, 252
 * sessions, cycle-turn markers) already parsed by the existing history reader.
 *
 * Reading contract:
 *  • Window "21 sessions"  → rs_21d measure over the last 21 sessions.
 *  • Window "63 sessions"  → rs_63d measure over the last 63 sessions.
 *  • Window "All history"  → rs_63d measure over every carried session (≤252).
 *  Lines are rebased to 0 at the start of the window (change in relative
 *  strength since the window opened); the exact-value table carries the same
 *  rebased numbers so chart and table can never disagree.
 *  • The theme performance TABLE reads the carried `theme_rows` typed block
 *    (wire v1.1 §3): names, the eleven state keys and the perf windows, one
 *    row per theme id in the producer's own order. The table and the history
 *    chart are INDEPENDENT blocks: each renders its own available/unavailable
 *    state whatever the other carries. A carried unavailable read renders its
 *    own per-reason state (RowBlockUnavailable — never a substitute panel); an
 *    omitted themeRows prop keeps the typed theme_table field state. The
 *    21/63-session RS series stay on the history surface — the table carries
 *    no per-theme series, and none is invented here.
 *
 *  • Each block carries its OWN date (review r1 B2): the history block prints
 *    its as-of beside its chart, the theme table prints its as-of beside the
 *    table, and `perf_as_of` shows only when it differs from the table's own
 *    date. The section header states no date that applies to only one block.
 *
 * Props-only: no routing, no fetching, no URL state. Pure helpers are exported
 * for unit tests (window slicing, rebasing, default selection, turn-window
 * filtering, x-label thinning).
 */
import { useMemo, useRef, useState, type Ref } from "react";
import type { SectorRotationHistory } from "@/lib/sectorIntelligence";
import { useLang } from "@/lib/i18n";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import {
  themeChartHref,
  type ThemePerfReading,
  type ThemePerfWindow,
  type ThemeRowsRead,
} from "@/lib/sectorDepthThemeRows";
import { DepthUnavailable } from "./DepthUnavailable";
import { RowBlockUnavailable } from "./RowBlockUnavailable";
import { MIN_CHART_H, fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import styles from "./SectorThemeCompare.module.css";

export type ThemeWindow = "21" | "63" | "all";
export type ThemePoint = { date: string; rs21: number; rs63: number };

/** Fixed categorical palette (house pattern: literal hex like YEAR_PALETTE,
 * distinguishable on both light and dark panels). */
export const THEME_PALETTE = [
  "#60a5fa", "#f97316", "#a3e635", "#e879f9", "#22d3ee",
  "#eab308", "#34d399", "#f472b6", "#2dd4bf", "#fb923c", "#818cf8",
];

/** The rs measure a window reads: 21↔rs_21d, 63↔rs_63d, all↔rs_63d. */
export function themeHorizon(window: ThemeWindow): 21 | 63 {
  return window === "21" ? 21 : 63;
}

/** Last-N sessions of a series (21 / 63), or every carried point for "all". */
export function themeWindowSlice(points: ThemePoint[], window: ThemeWindow): ThemePoint[] {
  if (window === "all" || points.length === 0) return points;
  const n = Number(window);
  return points.length <= n ? points : points.slice(points.length - n);
}

/** Rebase a sliced window to 0 at its start: change in rs since the window
 * opened. Empty input → empty output; never throws on malformed rows (guards). */
export function themeDeltas(
  points: ThemePoint[],
  horizon: 21 | 63,
): { date: string; v: number }[] {
  const out: { date: string; v: number }[] = [];
  if (!Array.isArray(points) || points.length === 0) return out;
  const pick = (p: ThemePoint) => (horizon === 21 ? p.rs21 : p.rs63);
  const base = pick(points[0]);
  if (typeof base !== "number" || !Number.isFinite(base)) return out;
  for (const p of points) {
    const v = pick(p);
    if (typeof v === "number" && Number.isFinite(v) && typeof p.date === "string") {
      out.push({ date: p.date, v: v - base });
    }
  }
  return out;
}

/** Latest raw rs value for a horizon (chip subtitle); null when unmeasured. */
export function themeLatestRs(points: ThemePoint[], horizon: 21 | 63): number | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const last = points[points.length - 1];
  const v = horizon === 21 ? last.rs21 : last.rs63;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Deterministic default selection: the `count` ids with the largest |latest
 * rs| for the horizon (ties by id, ascending), returned in the series' own key
 * order so the chip row never reorders when the window changes. */
export function themeDefaultSelection(
  series: { id: string; points: ThemePoint[] }[],
  horizon: 21 | 63,
  count = 4,
): string[] {
  const ranked = series
    .map((s) => ({ id: s.id, latest: themeLatestRs(s.points, horizon) }))
    .filter((s): s is { id: string; latest: number } => s.latest !== null)
    .sort((a, b) => Math.abs(b.latest) - Math.abs(a.latest) || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(1, count))
    .map((s) => s.id);
  const chosen = new Set(ranked);
  return series.filter((s) => chosen.has(s.id)).map((s) => s.id);
}

/** Cycle turns whose date falls inside the sliced window (inclusive). */
export function themeTurnsInWindow(
  turns: { date: string }[],
  firstDate: string,
  lastDate: string,
): { date: string }[] {
  if (!Array.isArray(turns)) return [];
  return turns.filter(
    (t) => t && typeof t.date === "string" && t.date >= firstDate && t.date <= lastDate,
  );
}

/** Pixel-gap thinning for x date labels (chart law: thin by mapped pixel gap). */
export function themeXLabels<T>(items: T[], xOf: (t: T) => number, minGapPx = 56): T[] {
  return thinLabels(items, xOf, minGapPx);
}

/** Delta formatting shared by chart ticks and the exact-value table so the two
 * surfaces can never disagree (U+2212 minus for negatives, 1 decimal). */
export function fmtThemeDelta(v: number): string {
  const s = Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1);
  return (v < 0 ? "−" : "+") + s;
}

/** Perf windows are fractions on the wire; the rows table shows signed
 * percent — ×100, one decimal (zero at ≥100%), U+2212 minus, same law as
 * fmtThemeDelta so no two surfaces format the same number differently. */
export function fmtThemePct(v: number): string {
  const p = v * 100;
  const s = Math.abs(p) >= 100 ? Math.abs(p).toFixed(0) : Math.abs(p).toFixed(1);
  return (p < 0 ? "−" : "+") + s + "%";
}

/** Breadth is a 0–1 fraction on the wire — the share of a theme's members
 * above their OWN 50-day MA (producer: engine/narrative_rotation.py:358-361,
 * `float(b.mean())`; the 0.25/0.55 band thresholds at engine/theme_context.py:72,81
 * confirm the 0–1 scale). The table shows it as a percent, one decimal,
 * UNSIGNED — it is a share, not a delta, so it never takes fmtThemePct's sign
 * (N6: unit established from the producer source, then formatted to match). */
export function fmtThemeBreadth(v: number): string {
  const p = v * 100;
  return (p >= 100 ? p.toFixed(0) : p.toFixed(1)) + "%";
}

/* ── theme_rows vocabulary (producer words → authored lexicon) ─────────────
 * EN shows the producer's vocabulary word verbatim (the lexicon's EN tuple
 * mirrors it); ZH reads the authored word. A word outside tonight's closed
 * set renders the localized generic "unclassified" and carries the raw word
 * ONLY in data-val for triage — never as visible text, in either locale. */
const LABEL_WORD_KEYS: Record<string, string> = {
  deteriorating: "siThemeWordLabelDeteriorating",
  dominant: "siThemeWordLabelDominant",
  emerging: "siThemeWordLabelEmerging",
  neutral: "siThemeWordLabelNeutral",
};
const RECO_WORD_KEYS: Record<string, string> = {
  accumulate: "siThemeWordRecoAccumulate",
  avoid: "siThemeWordRecoAvoid",
  enter: "siThemeWordRecoEnter",
  hold: "siThemeWordRecoHold",
};
const HEALTH_WORD_KEYS: Record<string, string> = {
  broken: "siThemeWordHealthBroken",
  confirmed: "siThemeWordHealthConfirmed",
  mixed: "siThemeWordHealthMixed",
};
const VAL_WORD_KEYS: Record<string, string> = {
  confirming: "siThemeWordValConfirming",
  diverging: "siThemeWordValDiverging",
  fading: "siThemeWordValFading",
  no_data: "siThemeWordValNoData",
  quiet: "siThemeWordValQuiet",
};

type DepthT = ReturnType<typeof useSectorDepthT>;

/** Localize one state word; null (absent key) reads not stated. */
function themeWord(
  t: DepthT,
  vocab: Record<string, string>,
  raw: string | null,
): { text: string; val: string | null } {
  if (raw === null) return { text: t("siThemePerfNotStated"), val: null };
  const key = Object.hasOwn(vocab, raw) ? vocab[raw] : null;
  if (key === null) return { text: t("siThemeStateUnknown"), val: raw };
  return { text: t(key), val: null };
}

/** One perf window cell (N6: both numbers are labelled). Both sides present:
 * `ret · rel` in that order — the legend above the table names the pair
 * ("return · vs benchmark"). ONE side present: the cell names its own side,
 * so a lone number is never an unlabelled half-pair. Not stated when the
 * window (or the whole perf key) is absent. `ret` is the raw fractional
 * return and `rel` the return relative to the benchmark — SPY
 * (producer: engine/baskets.py:126-158, "raw + (vs-SPY) relative return"). */
function themePerfCell(
  t: DepthT,
  reading: ThemePerfReading | undefined,
): { text: string; sign: "up" | "down" | null } | null {
  if (reading === undefined) return null;
  const { ret, rel } = reading;
  if (ret === null && rel === null) return null;
  const lead = ret ?? rel;
  let cellText: string;
  if (ret !== null && rel !== null) {
    cellText = `${fmtThemePct(ret)} · ${fmtThemePct(rel)}`;
  } else if (ret !== null) {
    cellText = `${t("siThemePerfRetWord")} ${fmtThemePct(ret)}`;
  } else {
    // Both-null returned above, so a cell reaching here has rel set.
    cellText = `${t("siThemePerfRelWord")} ${fmtThemePct(rel!)}`;
  }
  return { text: cellText, sign: lead !== null && lead < 0 ? "down" : "up" };
}

const PERF_WINDOW_KEYS: Record<ThemePerfWindow, string> = {
  "1d": "siThemeWin1d",
  "5d": "siThemeWin5d",
  "10d": "siThemeWin10d",
  "20d": "siThemeWin20d",
  "60d": "siThemeWin60d",
  mtd: "siThemeWinMtd",
  ytd: "siThemeWinYtd",
  full: "siThemeWinFull",
};
const PERF_WINDOW_ORDER: readonly ThemePerfWindow[] = [
  "1d", "5d", "10d", "20d", "60d", "mtd", "ytd", "full",
];

export function SectorThemeCompare({
  history,
  labels,
  themeRows,
  onNavigate,
  captureRef,
}: {
  /** Parsed rotation history from the selected native generation. */
  history: SectorRotationHistory | null;
  /** Optional id → localized display name (falls back to the ticker). */
  labels?: Record<string, string>;
  /** The carried `theme_rows` typed-block read (themeRowsFromCarriedBlock).
   * Absent/undefined keeps the typed unavailable state — the table is never
   * partially invented. */
  themeRows?: ThemeRowsRead | null;
  /** Same-site navigation for the per-theme detail links (the href is
   * composed from chart_key; no link exists without a conforming key). */
  onNavigate?: (href: string) => void;
  captureRef?: Ref<HTMLElement>;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  const [window, setWindow] = useState<ThemeWindow>("21");
  const [active, setActive] = useState<ReadonlySet<string> | null>(null);
  const [showTable, setShowTable] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const vw = useChartWidth(boxRef, 640);
  const vh = Math.max(MIN_CHART_H.axis, 230);

  const entries = useMemo(
    () => (history ? Object.values(history.series) : []),
    [history],
  );

  const horizon = themeHorizon(window);
  const activeIds = useMemo(() => {
    if (!entries.length) return [] as string[];
    if (active === null) return themeDefaultSelection(entries, horizon);
    return entries.filter((s) => active.has(s.id)).map((s) => s.id);
  }, [active, entries, horizon]);

  // window → per-series { points, deltas, turns } for the ACTIVE ids only.
  const activeSeries = useMemo(
    () =>
      entries
        .filter((s) => activeIds.includes(s.id))
        .map((s) => {
          const sliced = themeWindowSlice(s.points, window);
          const deltas = themeDeltas(sliced, horizon);
          return { id: s.id, ticker: s.ticker, sliced, deltas, turns: s.cycleTurns ?? [] };
        }),
    [entries, activeIds, window, horizon],
  );

  // The two blocks are INDEPENDENT (review r1 B1): the history chart and the
  // theme table each render their own available/unavailable state whatever the
  // other carries. The whole-component state survives only when BOTH are absent
  // — history null with NO themeRows read passed at all, exactly the
  // pre-increment (master) mount.
  if (!history && !themeRows) {
    return (
      <DepthUnavailable
        field="rs_history"
        owner="macro_sector_generation"
        title={t("siThemeTitle")}
      />
    );
  }

  const flat: number[] = [];
  for (const s of activeSeries) for (const d of s.deltas) flat.push(d.v);
  const dom = flat.length
    ? padDomain(Math.min(...flat), Math.max(...flat), { includeZero: true, padFrac: 0.08 })
    : ([0, 1] as [number, number]);
  const ticks = niceTicks(dom[0], dom[1], 5);

  const PAD = { t: 14, r: 14, b: 30, l: 46 };
  const iw = Math.max(1, vw - PAD.l - PAD.r);
  const ih = vh - PAD.t - PAD.b;
  const maxPts = Math.max(1, ...activeSeries.map((s) => s.deltas.length));
  const x = (i: number) => PAD.l + (i / Math.max(1, maxPts - 1)) * iw;
  const y = (v: number) => PAD.t + ih - ((v - dom[0]) / (dom[1] - dom[0] || 1)) * ih;

  const xLabelDates = activeSeries[0]?.deltas.map((d) => d.date) ?? [];
  const thinnedX = themeXLabels(
    xLabelDates.map((date, i) => ({ date, i })),
    (t2) => x(t2.i),
    56,
  );

  const line = (deltas: { v: number }[]) =>
    deltas
      .map((d, i) => `${x(i).toFixed(1)},${y(d.v).toFixed(1)}`)
      .join(" ");

  const basisNote = history
    ? t("siThemeRebasedNote", { benchmark: history.benchmark, basis: history.basis })
    : null;

  const notStated = t("siThemePerfNotStated");
  const numCell = (v: number | null) => (v === null ? notStated : String(v));

  return (
    <section
      className={styles.root}
      aria-label={t("siThemeTitle")}
      ref={captureRef as React.Ref<HTMLElement>}
      data-window={window}
    >
      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>{t("siThemeTitle")}</h3>
          <p className={styles.sub}>{t("siThemeSub")}</p>
        </div>
      </header>

      {history ? (
        <>
          <div className={styles.controls}>
            <div className={styles.seg} role="group" aria-label={t("siThemeChartTitle")}>
              {(["21", "63", "all"] as ThemeWindow[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  className={styles.segBtn + (window === w ? ` ${styles.on}` : "")}
                  aria-pressed={window === w}
                  onClick={() => setWindow(w)}
                >
                  {w === "21" ? t("siThemeWindow21") : w === "63" ? t("siThemeWindow63") : t("siThemeWindowAll")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.tableToggle}
              aria-expanded={showTable}
              onClick={() => setShowTable((s) => !s)}
            >
              {t("siThemeExactValues")}
            </button>
          </div>

          <div className={styles.chips}>
            {entries.map((s, idx) => {
              const on = activeIds.includes(s.id);
              const latest = themeLatestRs(themeWindowSlice(s.points, "all"), horizon);
              const name = labels?.[s.id] ?? s.ticker;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={styles.chip + (on ? ` ${styles.on}` : "")}
                  aria-pressed={on}
                  aria-label={t("siThemeSeriesToggle", { name })}
                  onClick={() =>
                    setActive((prev) => {
                      const base = prev ?? new Set(activeIds);
                      const next = new Set(base);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                >
                  <i className={styles.dot} style={{ background: on ? THEME_PALETTE[idx % THEME_PALETTE.length] : "var(--text-2)" }} />
                  <span className={styles.chipName}>{name}</span>
                  {latest !== null && (
                    <span className={styles.chipVal} data-sign={latest >= 0 ? "up" : "down"}>
                      {fmtThemeDelta(latest)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className={styles.chartbox} ref={boxRef} style={{ height: vh }}>
            <svg viewBox={`0 0 ${vw} ${vh}`} width={vw} height={vh} className={styles.svg} role="img" aria-label={t("siThemeChartTitle")}>
              {ticks.values.map((tk) => (
                <g key={tk}>
                  <line className={tk === 0 ? `${styles.grid} ${styles.grid0}` : styles.grid} x1={PAD.l} x2={vw - PAD.r} y1={y(tk)} y2={y(tk)} />
                  <text className={styles.axisY} x={PAD.l - 6} y={y(tk) + 3} textAnchor="end">
                    {fmtTick(tk, ticks.step)}
                  </text>
                </g>
              ))}

              {activeSeries.map((s, si) => {
                const color = THEME_PALETTE[entries.findIndex((e) => e.id === s.id) % THEME_PALETTE.length] ?? THEME_PALETTE[si % THEME_PALETTE.length];
                if (s.deltas.length === 0) return null;
                const first = s.sliced[0]?.date ?? "";
                const last = s.sliced[s.sliced.length - 1]?.date ?? "";
                const turns = themeTurnsInWindow(s.turns, first, last);
                const dateIdx = new Map(s.deltas.map((d, i) => [d.date, i]));
                return (
                  <g key={s.id}>
                    <polyline
                      className={styles.line}
                      points={line(s.deltas)}
                      fill="none"
                      stroke={color}
                    />
                    {turns.map((turn) => {
                      const idx = dateIdx.get(turn.date);
                      const pt = idx !== undefined ? s.deltas[idx] : undefined;
                      if (idx === undefined || !pt) return null;
                      const k = (s.turns.find((tt) => tt.date === turn.date)?.kind ?? "peak") as "peak" | "trough";
                      const provisional = s.turns.find((tt) => tt.date === turn.date)?.provisional ?? false;
                      const cx = x(idx);
                      const cy = y(pt.v);
                      const label = `${k === "peak" ? t("siThemeTurnPeak", { date: turn.date }) : t("siThemeTurnTrough", { date: turn.date })}${provisional ? ` · ${t("siThemeTurnProvisional")}` : ""}`;
                      return (
                        <circle
                          key={turn.date}
                          className={styles.turn + (k === "peak" ? ` ${styles.turnPeak}` : ` ${styles.turnTrough}`)}
                          cx={cx}
                          cy={cy}
                          r={3.4}
                          stroke={color}
                          fill={provisional ? "var(--panel)" : color}
                        >
                          <title>{label}</title>
                        </circle>
                      );
                    })}
                  </g>
                );
              })}

              {thinnedX.map(({ date, i }) => (
                <text key={date} className={styles.axisX} x={x(i)} y={vh - 9} textAnchor="middle">
                  {date}
                </text>
              ))}

              {activeSeries.length === 0 && (
                <text className={styles.emptyTxt} x={vw / 2} y={vh / 2} textAnchor="middle">
                  {t("siThemeNoneSelected")}
                </text>
              )}
            </svg>
          </div>

          <p className={styles.note} data-history-asof={history.asOf}>
            {t("siDepthAsOf", { date: history.asOf })}
          </p>
          <p className={styles.note}>
            {basisNote}
            {history.naturallyObserved ? ` · ${t("siThemeNaturallyObserved")}` : ` · ${t("siThemeReconstructed")}`}
          </p>
          <p className={styles.noteSecondary}>{t("siThemeTurnMarkers")}</p>

          {showTable && (
            <div className={styles.tableWrap} role="region" aria-label={t("siThemeExactValues")} tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.th}>{t("siThemeDateCol")}</th>
                    {activeSeries.map((s) => (
                      <th key={s.id} scope="col" className={styles.th}>
                        {labels?.[s.id] ?? s.ticker}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(activeSeries[0]?.deltas ?? []).map((d, i) => (
                    <tr key={d.date}>
                      <th scope="row" className={styles.thRow}>{d.date}</th>
                      {activeSeries.map((s) => {
                        const cell = s.deltas[i];
                        return (
                          <td key={s.id} className={styles.td} data-sign={cell ? (cell.v >= 0 ? "up" : "down") : undefined}>
                            {cell ? fmtThemeDelta(cell.v) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        // The rotation history itself is not carried tonight: its own honest
        // unavailable state, INSIDE the section, beside the carried table.
        <DepthUnavailable
          field="rs_history"
          owner="macro_sector_generation"
          title={t("siThemeChartTitle")}
        />
      )}

      {themeRows?.state === "available" ? (
        <div className={styles.rowsBlock}>
          <h4 className={styles.rowsHead}>{t("siThemeTableTitle")}</h4>
          <p className={styles.perfAsOf} data-rows-asof={themeRows.asOf}>
            {t("siDepthAsOf", { date: themeRows.asOf })}
          </p>
          {themeRows.perfAsOf !== null && themeRows.perfAsOf !== themeRows.asOf && (
            <p className={styles.perfAsOf}>{t("siThemePerfAsOf", { date: themeRows.perfAsOf })}</p>
          )}
          <p className={styles.perfAsOf} data-perf-legend="true">{t("siThemePerfLegend")}</p>
          <div className={styles.tableWrap} role="region" aria-label={t("siThemeTableTitle")} tabIndex={0}>
            <table className={styles.table} data-theme-rows="true">
              <thead>
                <tr>
                  <th scope="col" className={styles.th}>{t("siThemeColTheme")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColState")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColReco")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColScore")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColRank")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColAllocRank")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColHealth")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColVal")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColBreadth")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColR10")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColDays")}</th>
                  <th scope="col" className={styles.th}>{t("siThemeColDelta5d")}</th>
                  {PERF_WINDOW_ORDER.map((w) => (
                    <th key={w} scope="col" className={styles.th}>{t(PERF_WINDOW_KEYS[w])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {themeRows.rows.map((row) => {
                  const name = (lang === "zh" ? row.name_zh ?? row.name : row.name) ?? row.id;
                  const href = themeChartHref(row.chart_key);
                  const label = themeWord(t, LABEL_WORD_KEYS, row.state.label);
                  const reco = themeWord(t, RECO_WORD_KEYS, row.state.reco);
                  const health = themeWord(t, HEALTH_WORD_KEYS, row.state.health);
                  const val = themeWord(t, VAL_WORD_KEYS, row.state.val_state);
                  return (
                    <tr key={row.id} data-r-id={row.id}>
                      <th scope="row" className={styles.thRow}>
                        {href === undefined ? (
                          name
                        ) : onNavigate ? (
                          <button type="button" className={styles.themeLink} onClick={() => onNavigate(href)}>
                            {name}
                          </button>
                        ) : (
                          <a className={styles.themeLink} href={href}>
                            {name}
                          </a>
                        )}
                      </th>
                      <td className={styles.td} data-val={label.val ?? undefined}>{label.text}</td>
                      <td className={styles.td} data-val={reco.val ?? undefined}>{reco.text}</td>
                      <td className={styles.td} data-k="score">{numCell(row.state.score)}</td>
                      <td className={styles.td} data-k="rank">{numCell(row.state.rank)}</td>
                      <td className={styles.td} data-k="alloc_rank">{numCell(row.state.alloc_rank)}</td>
                      <td className={styles.td} data-val={health.val ?? undefined}>{health.text}</td>
                      <td className={styles.td} data-val={val.val ?? undefined}>{val.text}</td>
                      <td className={styles.td} data-k="breadth">
                        {row.state.breadth === null ? notStated : fmtThemeBreadth(row.state.breadth)}
                      </td>
                      <td
                        className={styles.td}
                        data-k="r10"
                        data-sign={row.state.r10 === null ? undefined : row.state.r10 < 0 ? "down" : "up"}
                      >
                        {row.state.r10 === null ? notStated : fmtThemePct(row.state.r10)}
                      </td>
                      <td className={styles.td} data-k="days_in_label">{numCell(row.state.days_in_label)}</td>
                      <td
                        className={styles.td}
                        data-k="score_delta_5d"
                        data-sign={row.state.score_delta_5d === null ? undefined : row.state.score_delta_5d < 0 ? "down" : "up"}
                      >
                        {row.state.score_delta_5d === null ? notStated : fmtThemeDelta(row.state.score_delta_5d)}
                      </td>
                      {PERF_WINDOW_ORDER.map((w) => {
                        const cell = themePerfCell(t, row.perf === null ? undefined : row.perf[w]);
                        return (
                          <td key={w} className={styles.td} data-w={w} data-sign={cell?.sign ?? undefined}>
                            {cell === null ? notStated : cell.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : themeRows ? (
        // A carried but unavailable read: its own honest per-reason state — the
        // same copy law the universes board uses (the raw reason word never
        // reaches the DOM; a hostile out-of-set reason falls to the generic).
        <RowBlockUnavailable reason={themeRows.reason} title={t("siThemeTableTitle")} />
      ) : (
        // No themeRows read passed at all: the pre-increment typed field state
        // (master behaviour) — never a partial or invented table.
        <DepthUnavailable
          field="theme_table"
          owner="macro_sector_generation"
          title={t("siThemeTableTitle")}
        />
      )}
    </section>
  );
}
