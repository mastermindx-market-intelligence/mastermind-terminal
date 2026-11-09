"use client";
// D3 Table View — replaces the chart region (same layout slot as MegaPane in workspace mode).
// Shows OHLC + Change + Volume + per-indicator value for every bar; newest first; virtualized.
// "Download data" exports a CSV of the visible column set.

import { useRef, useState, useCallback, useMemo } from "react";
import { useT } from "@/lib/i18n";

// Accept the broader Bar shape (time can be string | number per lib/fund)
type Bar = { time: string | number; o: number; h: number; l: number; c: number; v: number };

type Row = Bar & { change: number; changePct: number };

const fmtNum = (n: number | null | undefined, d = 2): string =>
  n == null || !isFinite(n) ? "∅" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtVol = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return "∅";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const fmtDate = (t: string | number): string => {
  try {
    const ts = typeof t === "number" ? new Date(t * 1000) : new Date(String(t) + "T00:00:00Z");
    return ts.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }).replace(",", "");
  } catch { return String(t); }
};

// Active indicator labels from pane layout entries
type IndCol = { key: string; label: string; tag: string };

// Per-bar indicator value extractor — we read from the indSeriesRef data that ChartPanel exposes
// via the callback (indRowsAt). If not available, cells show ∅.
export type IndRowsAt = (barTime: string | number) => Record<string, number | null>;

type Props = {
  symbol: string;
  timeframe: string;
  bars: readonly Bar[];
  indCols: IndCol[];       // indicator columns (ordered by legend)
  indRowsAt?: IndRowsAt;  // optional: returns value map at a bar time
  onBack: () => void;
};

const ROW_H = 32;
const OVERSCAN = 10;

export default function ChartTableView({ symbol, timeframe, bars, indCols, indRowsAt, onBack }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Rows newest-first
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (let i = bars.length - 1; i >= 0; i--) {
      const b = bars[i];
      const prev = bars[i - 1];
      const change = prev ? b.c - prev.c : 0;
      const changePct = prev && prev.c ? (change / prev.c) * 100 : 0;
      out.push({ ...b, change, changePct });
    }
    return out;
  }, [bars]);

  const totalH = rows.length * ROW_H;
  const containerH = containerRef.current?.clientHeight ?? 600;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + containerH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(startIdx, endIdx);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // CSV download
  const download = useCallback(() => {
    const headers = ["Date", "Open", "High", "Low", "Close", "Change", "Change%", "Volume", ...indCols.map((c) => c.tag)];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const indVals = indCols.map((c) => {
        const v = indRowsAt?.(r.time)?.[c.key];
        return v != null && isFinite(v) ? v.toFixed(4) : "";
      });
      lines.push([
        r.time,
        r.o.toFixed(4),
        r.h.toFixed(4),
        r.l.toFixed(4),
        r.c.toFixed(4),
        r.change.toFixed(4),
        r.changePct.toFixed(4),
        String(r.v ?? ""),
        ...indVals,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${symbol}_${timeframe}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [rows, indCols, indRowsAt, symbol, timeframe]);

  const prec = useMemo(() => {
    if (!bars.length) return 2;
    const avg = bars.reduce((s, b) => s + b.c, 0) / bars.length;
    return avg < 10 ? 4 : 2;
  }, [bars]);

  return (
    <div className="ctv-root">
      {/* Header */}
      <div className="ctv-head">
        <span className="ctv-sym">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
          <b>{symbol}</b>
          <span style={{ color: "var(--text-2)", fontWeight: 400 }}>{t("tableViewLabel")}</span>
        </span>
        <button className="btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          {t("backToChart")}
        </button>
      </div>

      {/* Download */}
      <div className="ctv-dl">
        <button className="btn" onClick={download}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          {t("ctvDownload")}
        </button>
        <span style={{ color: "var(--text-dim)", fontSize: 11.5, marginLeft: 8 }}>{rows.length.toLocaleString("en-US")} {t("ctvRows")}</span>
      </div>

      {/* Table */}
      <div className="ctv-table-wrap" ref={containerRef} onScroll={onScroll}>
        <div className="ctv-col-group">
          <div className="ctv-thead">
            <div className="ctv-th ctv-td-date">{t("ctvDate")} · {timeframe}</div>
            <div className="ctv-th ctv-td-ohlc">{t("open")}</div>
            <div className="ctv-th ctv-td-ohlc">{t("ctvHigh")}</div>
            <div className="ctv-th ctv-td-ohlc">{t("ctvLow")}</div>
            <div className="ctv-th ctv-td-ohlc">{t("ctvClose")}</div>
            <div className="ctv-th ctv-td-chg">{t("change")}</div>
            <div className="ctv-th ctv-td-vol">{t("volume")}</div>
            {indCols.map((c) => (
              <div key={c.key} className="ctv-th ctv-td-ind">{c.tag}</div>
            ))}
          </div>
          {/* Spacer for virtual scroll */}
          <div style={{ height: totalH, position: "relative" }}>
            <div style={{ position: "absolute", top: startIdx * ROW_H, left: 0, right: 0 }}>
              {visible.map((r, vi) => {
                const idx = startIdx + vi;
                const up = r.change >= 0;
                const indVals = indCols.map((c) => indRowsAt?.(r.time)?.[c.key] ?? null);
                return (
                  <div key={r.time} className={`ctv-row${idx % 2 === 0 ? "" : " alt"}`}>
                    <div className="ctv-td ctv-td-date">{fmtDate(r.time)}</div>
                    <div className="ctv-td ctv-td-ohlc num">{fmtNum(r.o, prec)}</div>
                    <div className="ctv-td ctv-td-ohlc num">{fmtNum(r.h, prec)}</div>
                    <div className="ctv-td ctv-td-ohlc num">{fmtNum(r.l, prec)}</div>
                    <div className="ctv-td ctv-td-ohlc num">{fmtNum(r.c, prec)}</div>
                    <div className={`ctv-td ctv-td-chg num ${up ? "up" : "down"}`}>
                      {up ? "+" : ""}{fmtNum(r.change, prec)} <span style={{ opacity: 0.75 }}>({up ? "+" : ""}{fmtNum(r.changePct, 2)}%)</span>
                    </div>
                    <div className="ctv-td ctv-td-vol num">{fmtVol(r.v)}</div>
                    {indVals.map((v, ci) => (
                      <div key={indCols[ci].key} className="ctv-td ctv-td-ind num">
                        {v != null && isFinite(v) ? fmtNum(v, 4) : "∅"}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
