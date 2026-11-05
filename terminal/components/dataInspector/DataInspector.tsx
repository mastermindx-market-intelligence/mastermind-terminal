"use client";
// Time-aware Data Inspector (E10) — the chart's table view.
//
// Shows the bars and study values the chart itself plotted (no second engine), keyed by canonical
// bar time: selection, jump, comparison and export all name bars by `String(bar.time)`, never by a
// row number, so sorting, virtual scrolling and a re-published bar set cannot re-point them. See
// lib/dataInspector.ts for the model and its tests.

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SCOPE_ROWS, buildCsv, buildRows, diffRows, emptySelection, formatBarTime, generationKey, indexRows,
  orderRows, parseJump, publishedColumns, reconcileSelection, resolveJump, selectRange, selectedRows,
  timeBasis, toggleKey,
  type InspectorBar, type InspectorColumn, type InspectorRow, type Selection, type SortDir, type ValuesAt,
} from "@/lib/dataInspector";
import { useDataInspectorT, zoneCity } from "@/lib/dataInspectorLex";
import { useLang } from "@/lib/i18n";
import { useMediaQuery } from "@/lib/useMediaQuery";
import styles from "./DataInspector.module.css";

type Props = {
  symbol: string;
  timeframe: string;
  /** the plotted bars as the chart published them (replay-sliced, ascending); [] = not published */
  bars: readonly InspectorBar[];
  columns: readonly InspectorColumn[];
  /** the chart's own per-bar readout; never recomputed here */
  valuesAt?: ValuesAt;
  /** the header's feed label (LIVE / DELAYED / EOD …); null when unknown */
  feedBasis: string | null;
  replay: boolean;
  /** the replay cutoff these bars were sliced at (null when replay is off) */
  replayCursor?: string | null;
  onBack: () => void;
  /** return to the chart at exactly this bar time; `label` is its exact human time */
  onShowOnChart: (time: string | number, label: string) => void;
};

type Notice =
  | { kind: "invalid" }
  | { kind: "missing"; label: string; before: string | null; after: string | null }
  | { kind: "range-too-many"; count: number }
  | { kind: "export-too-many"; count: number };

// What survives a round trip to the chart and back (the table unmounts while the chart is shown).
// One entry, keyed by symbol|timeframe; another generation starts clean.
let remembered: { generation: string; selection: Selection; sort: SortDir; focusKey: string | null } | null = null;

const OVERSCAN = 12;
const HEADER_H = 26;

const fmtNum = (n: number | null | undefined, d: number): string =>
  n == null || !Number.isFinite(n) ? "∅" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (n: number | null | undefined, d: number): string =>
  n == null || !Number.isFinite(n) ? "∅" : `${n > 0 ? "+" : ""}${fmtNum(n, d)}`;
const fmtVol = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "∅";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const domSafe = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, "_");

export default function DataInspector({ symbol, timeframe, bars, columns, valuesAt, feedBasis, replay, replayCursor = null, onBack, onShowOnChart }: Props) {
  const t = useDataInspectorT();
  const { lang } = useLang();
  const coarse = useMediaQuery("(pointer: coarse)");
  const rowH = coarse ? 44 : 32;
  const idBase = useId();

  const generation = generationKey(symbol, timeframe);
  const rowsAsc = useMemo(() => buildRows(bars), [bars]);
  const index = useMemo(() => indexRows(rowsAsc), [rowsAsc]);
  const basis = useMemo(() => timeBasis(symbol, timeframe, bars), [symbol, timeframe, bars]);
  const published = useMemo(() => publishedColumns(rowsAsc, columns, valuesAt), [rowsAsc, columns, valuesAt]);
  const prec = useMemo(() => {
    if (!bars.length) return 2;
    const avg = bars.reduce((s, b) => s + (Number.isFinite(b.c) ? b.c : 0), 0) / bars.length;
    return avg < 10 ? 4 : 2;
  }, [bars]);

  const memory = remembered?.generation === generation ? remembered : null;
  const [sort, setSort] = useState<SortDir>(memory?.sort ?? "desc");
  const [rawSelection, setRawSelection] = useState<Selection>(memory?.selection ?? emptySelection(generation));
  const [rawFocus, setRawFocus] = useState<string | null>(memory?.focusKey ?? null);
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const gridRef = useRef<HTMLDivElement>(null);
  // The chart is unmounted while the table is shown, so these bars are the ones it published at the
  // cursor in force when the table opened. If the replay rail moves meanwhile, say so and stop
  // exporting a scope that no longer matches the cursor.
  const [readAtCursor] = useState(replayCursor);
  const replayMoved = replay && replayCursor !== readAtCursor;

  // Identity is re-derived against every publication: surviving keys keep naming the same bars,
  // retired keys are dropped (never re-pointed at a neighbour), another symbol/timeframe starts empty.
  const selection = useMemo(() => reconcileSelection(rawSelection, generation, index), [rawSelection, generation, index]);
  const display = useMemo(() => orderRows(rowsAsc, sort), [rowsAsc, sort]);
  const focusKey = rawFocus != null && index.has(rawFocus) ? rawFocus : null;
  const picked = useMemo(() => selectedRows(rowsAsc, selection), [rowsAsc, selection]);

  useEffect(() => {
    remembered = { generation, selection, sort, focusKey };
  }, [generation, selection, sort, focusKey]);

  const hasRows = rowsAsc.length > 0;
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  const displayPos = useCallback((key: string): number => {
    const i = index.get(key);
    if (i == null) return -1;
    return sort === "asc" ? i : rowsAsc.length - 1 - i;
  }, [index, sort, rowsAsc.length]);

  const scrollToKey = useCallback((key: string, center = false) => {
    const el = gridRef.current;
    const pos = displayPos(key);
    if (!el || pos < 0) return;
    const top = pos * rowH;
    const bodyH = Math.max(rowH, el.clientHeight - HEADER_H);
    let next = el.scrollTop;
    if (center) next = Math.max(0, top - bodyH / 2 + rowH / 2);
    else if (top < el.scrollTop) next = top;
    else if (top + rowH > el.scrollTop + bodyH) next = top + rowH - bodyH;
    if (next !== el.scrollTop) { el.scrollTop = next; setScrollTop(next); }
  }, [displayPos, rowH]);

  const label = useCallback((time: string | number) => formatBarTime(time, basis), [basis]);
  // Column heads on a phone break between the date and the clock time, never inside either.
  const stamp = (time: string | number) => label(time).split(" ").map((part, i) => (
    <Fragment key={i}>{i > 0 && " "}<span className={styles.nowrap}>{part}</span></Fragment>
  ));
  const labelOfKey = useCallback((key: string | null) => {
    if (key == null) return null;
    const i = index.get(key);
    return i == null ? null : label(rowsAsc[i].time);
  }, [index, label, rowsAsc]);

  const applySelection = useCallback((next: Selection) => {
    setRawSelection(next);
    setNotice((n) => (n?.kind === "range-too-many" || n?.kind === "export-too-many" ? null : n));
  }, []);

  const extendTo = useCallback((key: string, from?: string | null) => {
    const base: Selection = from != null ? { ...selection, anchor: from } : selection.anchor ? selection : { ...selection, anchor: focusKey ?? key };
    const r = selectRange(base, index, rowsAsc, key);
    if (r.ok) applySelection(r.selection);
    else setNotice({ kind: "range-too-many", count: r.count });
  }, [selection, focusKey, index, rowsAsc, applySelection]);

  const onRowActivate = useCallback((row: InspectorRow, shift: boolean) => {
    setRawFocus(row.key);
    if (shift) { extendTo(row.key); return; }
    if (rangeMode) {
      if (rangeStart == null) {
        setRangeStart(row.key);
        applySelection({ generation, keys: new Set([row.key]), anchor: row.key });
      } else {
        extendTo(row.key, rangeStart);
        setRangeStart(null);
      }
      return;
    }
    applySelection(toggleKey(selection, row.key));
  }, [extendTo, rangeMode, rangeStart, applySelection, generation, selection]);

  const showOnChart = useCallback((key: string | null) => {
    if (key == null) return;
    const i = index.get(key);
    if (i == null) return;
    onShowOnChart(rowsAsc[i].time, label(rowsAsc[i].time));
  }, [index, rowsAsc, label, onShowOnChart]);

  const moveFocus = useCallback((delta: number | "home" | "end", shift: boolean) => {
    if (!display.length) return;
    const cur = focusKey != null ? displayPos(focusKey) : -1;
    let pos = delta === "home" ? 0 : delta === "end" ? display.length - 1 : cur < 0 ? 0 : cur + delta;
    pos = Math.max(0, Math.min(display.length - 1, pos));
    const key = display[pos].key;
    if (shift) extendTo(key, selection.anchor ?? focusKey ?? key);
    setRawFocus(key);
    scrollToKey(key);
  }, [display, focusKey, displayPos, extendTo, selection.anchor, scrollToKey]);

  const onGridKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor((viewH - HEADER_H) / rowH) - 1);
    switch (e.key) {
      case "ArrowDown": moveFocus(1, e.shiftKey); break;
      case "ArrowUp": moveFocus(-1, e.shiftKey); break;
      case "PageDown": moveFocus(page, e.shiftKey); break;
      case "PageUp": moveFocus(-page, e.shiftKey); break;
      case "Home": moveFocus("home", e.shiftKey); break;
      case "End": moveFocus("end", e.shiftKey); break;
      case " ": {
        const key = focusKey ?? display[0]?.key;
        if (key == null) return;
        setRawFocus(key);
        applySelection(toggleKey(selection, key));
        break;
      }
      case "Enter": showOnChart(focusKey ?? (picked.length === 1 ? picked[0].key : null)); break;
      case "Escape":
        if (!selection.keys.size) return;
        applySelection(emptySelection(generation));
        setRangeStart(null);
        break;
      default: return;
    }
    e.preventDefault();
  }, [viewH, rowH, moveFocus, focusKey, display, applySelection, selection, showOnChart, picked, generation]);

  const goTo = useCallback((key: string) => {
    setRawFocus(key);
    setNotice(null);
    scrollToKey(key, true);
    gridRef.current?.focus({ preventScroll: true });
  }, [scrollToKey]);

  const onJump = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const time = parseJump(jumpText.replace("T", " "), basis);
    if (time == null) { setNotice({ kind: "invalid" }); return; }
    const target = resolveJump(rowsAsc, time);
    if (target.kind === "exact") goTo(target.key);
    else setNotice({ kind: "missing", label: label(time), before: target.before, after: target.after });
  }, [jumpText, basis, rowsAsc, goTo, label]);

  const download = useCallback(() => {
    if (replayMoved) return;
    const scopeRows = picked.length ? (sort === "asc" ? picked : [...picked].reverse()) : display;
    const result = buildCsv(scopeRows, columns, valuesAt, {
      symbol, timeframe, basis, feedBasis, replay,
      scope: picked.length ? "selected" : "all",
      plottedRows: rowsAsc.length,
      order: sort,
      asOf: rowsAsc.length ? rowsAsc[rowsAsc.length - 1].time : null,
      exportedAt: new Date(),
    });
    if (!result.ok) {
      if (result.reason === "too-many") setNotice({ kind: "export-too-many", count: result.count });
      return;
    }
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [picked, sort, display, columns, valuesAt, symbol, timeframe, basis, feedBasis, replay, rowsAsc, replayMoved]);

  const diff = useMemo(
    () => (diffOpen && picked.length === 2 ? diffRows(picked[0], picked[1], columns, valuesAt) : null),
    [diffOpen, picked, columns, valuesAt],
  );

  // Panels that open above the grid (comparison, notices) take its height, and a sort moves every
  // row: keep the compared pair (when it fits) and the focused row in view so the bars being worked
  // on never scroll out from under the user. The focused row goes last, so it always wins.
  const pairEarlier = diff?.earlier.key ?? null;
  const pairLater = diff?.later.key ?? null;
  useLayoutEffect(() => {
    for (const key of [pairEarlier, pairLater, focusKey]) if (key != null) scrollToKey(key);
  }, [pairEarlier, pairLater, focusKey, scrollToKey, viewH]);

  const total = display.length;
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop - HEADER_H) / rowH) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN);
  const visible = display.slice(start, end);
  const rowId = (key: string) => `${idBase}-r-${domSafe(key)}`;
  const zoneText = basis.kind === "intraday" ? t("diZone", { zone: zoneCity(basis.zone, lang) }) : t("diSessionDates");
  const count = picked.length;

  const header = (
    <div className="ctv-head">
      <span className="ctv-sym">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>
        <b>{symbol}</b>
        <span className={styles.dim}>{t("tableViewLabel")}</span>
        <span className={styles.tf}>{timeframe}</span>
      </span>
      <button type="button" className={`btn ${styles.btn} ${styles.back}`} onClick={onBack}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        {t("backToChart")}
      </button>
    </div>
  );

  if (!rowsAsc.length) {
    return (
      <div className={`ctv-root ${styles.root}`} data-data-inspector="" data-generation={generation} data-row-count={0}>
        {header}
        <p className={styles.empty} role="status">{t("diEmpty", { symbol, tf: timeframe })}</p>
      </div>
    );
  }

  return (
    <div className={`ctv-root ${styles.root}`} data-data-inspector="" data-generation={generation} data-row-count={total}>
      {header}

      <div className={styles.toolbar}>
        <form className={styles.jump} onSubmit={onJump}>
          <label className={styles.jumpLabel} htmlFor={`${idBase}-jump`}>{basis.kind === "intraday" ? t("diJumpTime") : t("diJumpDate")}</label>
          <input
            id={`${idBase}-jump`}
            className={styles.input}
            type={basis.kind === "intraday" ? "datetime-local" : "date"}
            step={basis.kind === "intraday" ? (basis.seconds ? 1 : 60) : undefined}
            value={jumpText}
            onChange={(e) => setJumpText(e.target.value)}
          />
          <button type="submit" className={`btn ${styles.btn}`}>{t("diJumpGo")}</button>
        </form>
        <div className={styles.segment} role="group" aria-label={t("diTime")}>
          <button type="button" className={`btn ${styles.btn}`} aria-pressed={sort === "desc"} onClick={() => setSort("desc")}>{t("diSortNewest")}</button>
          <button type="button" className={`btn ${styles.btn}`} aria-pressed={sort === "asc"} onClick={() => setSort("asc")}>{t("diSortOldest")}</button>
        </div>
        <button type="button" className={`btn ${styles.btn}`} aria-pressed={rangeMode} onClick={() => { setRangeMode((m) => !m); setRangeStart(null); }}>{t("diRangeMode")}</button>
        <span className={styles.meta}>{zoneText}</span>
      </div>

      <div className={styles.actions}>
        <span className={styles.count} aria-live="polite">{count ? t("diSelectedCount", { n: count.toLocaleString("en-US") }) : t("diNoneSelected")}</span>
        <button type="button" className={`btn ${styles.btn}`} disabled={count !== 2} aria-pressed={!!diff} onClick={() => setDiffOpen(!diff)}>{t("diCompare")}</button>
        <button type="button" className={`btn ${styles.btn}`} disabled={count !== 1} onClick={() => showOnChart(picked[0]?.key ?? null)}>{t("diShowOnChart")}</button>
        <button type="button" className={`btn ${styles.btn}`} disabled={!count} onClick={() => { applySelection(emptySelection(generation)); setRangeStart(null); }}>{t("diClear")}</button>
        <span className={styles.spacer} />
        <button type="button" className={`btn ${styles.btn}`} disabled={replayMoved} onClick={download}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          {t("ctvDownload")}
        </button>
        <span className={styles.meta} data-export-scope={count ? "selected" : "all"}>
          {count ? t("diScopeSelected", { n: count.toLocaleString("en-US") }) : t("diScopeAll", { n: total.toLocaleString("en-US") })}
        </span>
      </div>

      {(notice || (rangeMode && rangeStart == null) || replay) && (
        <div className={styles.notices}>
          {replay && !replayMoved && <p className={styles.note}>{t("diReplayNote")}</p>}
          {replayMoved && <div className={styles.notice} role="status" data-notice="replay-moved">{t("diReplayMoved")}</div>}
          {rangeMode && rangeStart == null && <p className={styles.note}>{t("diRangeHint")}</p>}
          {notice && (
            <div
              className={styles.notice}
              role="status"
              data-notice={notice.kind} // plain-language-ok: a test hook attribute, never rendered text
            >
              {notice.kind === "invalid" && t("diJumpInvalid")}
              {notice.kind === "range-too-many" && t("diRangeTooMany", { n: notice.count.toLocaleString("en-US"), max: MAX_SCOPE_ROWS.toLocaleString("en-US") })}
              {notice.kind === "export-too-many" && t("diExportTooMany", { n: notice.count.toLocaleString("en-US"), max: MAX_SCOPE_ROWS.toLocaleString("en-US") })}
              {notice.kind === "missing" && (
                <>
                  <span>{t("diJumpMissing", { time: notice.label })}</span>
                  <span className={styles.nearby}>
                    {notice.before
                      ? <button type="button" className={`btn ${styles.btn}`} onClick={() => goTo(notice.before!)}>{t("diJumpBefore", { time: labelOfKey(notice.before) ?? "" })}</button>
                      : <span className={styles.dim}>{t("diJumpNone")}</span>}
                    {notice.after
                      ? <button type="button" className={`btn ${styles.btn}`} onClick={() => goTo(notice.after!)}>{t("diJumpAfter", { time: labelOfKey(notice.after) ?? "" })}</button>
                      : <span className={styles.dim}>{t("diJumpNone")}</span>}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {diff && (
        <section className={styles.diff} aria-label={t("diDiffTitle")} data-diff="">
          <div className={styles.diffHead}>
            <b>{t("diDiffTitle")}</b>
            <span className={styles.dim}>{diff.barsApart === 1 ? t("diDiffBarApart") : t("diDiffBarsApart", { n: diff.barsApart.toLocaleString("en-US") })}</span>
            <span className={styles.spacer} />
            <button type="button" className={`btn ${styles.btn}`} onClick={() => setDiffOpen(false)}>{t("diHideDiff")}</button>
          </div>
          <div className={styles.diffScroll}>
            <table className={styles.diffTable}>
              <thead>
                <tr>
                  <th scope="col">{t("diDiffField")}</th>
                  <th scope="col">{t("diDiffEarlier")}<br /><span className={styles.dim} data-diff-earlier={diff.earlier.key}>{stamp(diff.earlier.time)}</span></th>
                  <th scope="col">{t("diDiffLater")}<br /><span className={styles.dim} data-diff-later={diff.later.key}>{stamp(diff.later.time)}</span></th>
                  <th scope="col">{t("diDiffChange")}</th>
                  <th scope="col">{t("diDiffPct")}</th>
                </tr>
              </thead>
              <tbody>
                {diff.fields.map((f) => {
                  const col = columns.find((c) => c.key === f.id);
                  const name = f.unit === "study" ? (col?.tag ?? f.id)
                    : f.id === "open" ? t("open") : f.id === "high" ? t("ctvHigh") : f.id === "low" ? t("ctvLow") : f.id === "close" ? t("ctvClose") : t("volume");
                  const d = f.unit === "study" ? 4 : prec;
                  const show = (v: number | null) => (f.unit === "volume" ? fmtVol(v) : fmtNum(v, d));
                  return (
                    <tr key={f.id} data-diff-field={f.id}>
                      <th scope="row">{name}</th>
                      <td>{show(f.earlier)}</td>
                      <td>{show(f.later)}</td>
                      <td className={f.delta == null || f.delta === 0 ? "" : f.delta > 0 ? "up" : "down"}>{f.unit === "volume" ? (f.delta == null ? "∅" : `${f.delta > 0 ? "+" : ""}${fmtVol(f.delta)}`) : fmtSigned(f.delta, d)}</td>
                      <td>{f.unit === "study" ? "" : f.pct == null ? "∅" : `${fmtSigned(f.pct, 2)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>{t("diDiffStudyUnits")} {t("diNullLegend")}</p>
        </section>
      )}

      <div
        ref={gridRef}
        className={`ctv-table-wrap ${styles.grid}`}
        role="grid"
        tabIndex={0}
        aria-label={t("diGridLabel", { symbol, tf: timeframe })}
        aria-multiselectable="true"
        aria-rowcount={total + 1}
        aria-activedescendant={focusKey != null && displayPos(focusKey) >= start && displayPos(focusKey) < end ? rowId(focusKey) : undefined}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onGridKey}
        data-sort={sort}
      >
        <div className="ctv-col-group">
          <div className={`ctv-thead ${styles.head}`} role="row" aria-rowindex={1} style={{ height: HEADER_H }}>
            <div className={`ctv-th ${styles.cCheck}`} role="columnheader"><span className={styles.srOnly}>{t("diSelect")}</span></div>
            <div className={`ctv-th ${styles.cTime}`} role="columnheader" aria-sort={sort === "desc" ? "descending" : "ascending"}>{t("diTime")} · {timeframe}</div>
            <div className={`ctv-th ${styles.cNum}`} role="columnheader">{t("open")}</div>
            <div className={`ctv-th ${styles.cNum}`} role="columnheader">{t("ctvHigh")}</div>
            <div className={`ctv-th ${styles.cNum}`} role="columnheader">{t("ctvLow")}</div>
            <div className={`ctv-th ${styles.cNum}`} role="columnheader">{t("ctvClose")}</div>
            <div className={`ctv-th ${styles.cChg}`} role="columnheader">{t("change")}</div>
            <div className={`ctv-th ${styles.cNum}`} role="columnheader">{t("volume")}</div>
            {columns.map((c) => (
              <div key={c.key} className={`ctv-th ${styles.cInd}`} role="columnheader" data-column-key={c.key} title={c.label}>
                {c.tag}{published.has(c.key) ? null : <span className={styles.noValues}> · {t("diNoValues")}</span>}
              </div>
            ))}
          </div>
          <div style={{ height: total * rowH, position: "relative" }}>
            <div style={{ position: "absolute", top: start * rowH, left: 0, right: 0 }}>
              {visible.map((r, vi) => {
                const pos = start + vi;
                const sel = selection.keys.has(r.key);
                const values = valuesAt?.(r.time) ?? {};
                const dir = r.change == null || r.change === 0 ? "" : r.change > 0 ? "up" : "down";
                return (
                  <div
                    key={r.key}
                    id={rowId(r.key)}
                    role="row"
                    aria-rowindex={pos + 2}
                    aria-selected={sel}
                    className={`ctv-row${pos % 2 ? " alt" : ""} ${styles.row}`}
                    style={{ height: rowH }}
                    data-row-key={r.key}
                    data-row-time={String(r.time)}
                    data-selected={sel ? "" : undefined}
                    data-focused={focusKey === r.key ? "" : undefined}
                    data-range-start={rangeStart === r.key ? "" : undefined}
                    onClick={(e) => onRowActivate(r, e.shiftKey)}
                  >
                    <div className={`ctv-td ${styles.cCheck}`} role="gridcell"><span className={styles.check} aria-hidden="true">{sel ? "✓" : ""}</span></div>
                    <div className={`ctv-td num ${styles.cTime}`} role="gridcell">{label(r.time)}</div>
                    <div className={`ctv-td num ${styles.cNum}`} role="gridcell">{fmtNum(r.bar.o, prec)}</div>
                    <div className={`ctv-td num ${styles.cNum}`} role="gridcell">{fmtNum(r.bar.h, prec)}</div>
                    <div className={`ctv-td num ${styles.cNum}`} role="gridcell">{fmtNum(r.bar.l, prec)}</div>
                    <div className={`ctv-td num ${styles.cNum}`} role="gridcell">{fmtNum(r.bar.c, prec)}</div>
                    <div className={`ctv-td num ${styles.cChg} ${dir}`} role="gridcell">
                      {fmtSigned(r.change, prec)}{r.changePct == null ? null : <span className={styles.pct}>({fmtSigned(r.changePct, 2)}%)</span>}
                    </div>
                    <div className={`ctv-td num ${styles.cNum}`} role="gridcell">{fmtVol(r.bar.v)}</div>
                    {columns.map((c) => (
                      <div key={c.key} className={`ctv-td num ${styles.cInd}`} role="gridcell">{fmtNum(values[c.key], 4)}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <span>{t("diNullLegend")}</span>
        {!coarse && <span className={styles.hint}>{t("diKeyboardHint")}</span>}
      </div>
    </div>
  );
}
