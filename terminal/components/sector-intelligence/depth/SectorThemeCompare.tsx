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
 *  • The theme performance TABLE is a separate generation field the captured
 *    generation does not carry — it renders the typed unavailable state until
 *    the Macro generation lane supplies it (never a substitute panel).
 *
 * Props-only: no routing, no fetching, no URL state. Pure helpers are exported
 * for unit tests (window slicing, rebasing, default selection, turn-window
 * filtering, x-label thinning).
 */
import { useMemo, useRef, useState, type Ref } from "react";
import type { SectorRotationHistory } from "@/lib/sectorIntelligence";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import { DepthUnavailable } from "./DepthUnavailable";
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

export function SectorThemeCompare({
  history,
  labels,
  captureRef,
}: {
  /** Parsed rotation history from the selected native generation. */
  history: SectorRotationHistory | null;
  /** Optional id → localized display name (falls back to the ticker). */
  labels?: Record<string, string>;
  captureRef?: Ref<HTMLElement>;
}) {
  const t = useSectorDepthT();
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

  if (!history) {
    return (
      <DepthUnavailable
        field="rs_history"
        owner="Macro sector generation"
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

  const basisNote = t("siThemeRebasedNote", {
    benchmark: history.benchmark,
    basis: history.basis,
  });

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
        <span className={styles.asof}>{t("siDepthAsOf", { date: history.asOf })}</span>
      </header>

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

      {/* The theme performance TABLE is a generation field the captured owner
          output does not carry. Typed unavailable — never a substitute panel. */}
      <DepthUnavailable
        field="theme_table"
        owner="Macro sector generation"
        title={t("siThemeTableTitle")}
      />
    </section>
  );
}
