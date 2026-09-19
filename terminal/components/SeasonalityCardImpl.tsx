"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { getBars } from "@/lib/fund";
import { MAX_YEARS } from "@/lib/seasonal";

const M = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MonthStat = { avg: number; wr: number; n: number } | null;

// Average monthly return from history → a TrendSpider-style seasonality read (display-only).
// Every month's bar grows UP from a shared baseline (negative months are simply red, not inverted),
// so the row reads as a single comparable magnitude chart. Hover a bar for its avg return + win rate.
export default function SeasonalityCard({ symbol, onOpenPane }: { symbol: string; onOpenPane?: () => void }) {
  const t = useT();
  // per-month { average return %, win rate %, sample count }, or null for months with no samples
  const [stats, setStats] = useState<MonthStat[] | null>(null);

  useEffect(() => {
    let dead = false;
    // getBars routes through dataCache (dedupes with the chart's OHLC fetch — no third raw fetch)
    getBars(symbol).then((allBars) => {
      if (dead || !allBars.length) { setStats(null); return; }
      // 10y lookback (MAX_YEARS): keep only bars from the last N complete years +
      // the current YTD, so the mini read matches the full Seasonals page default
      // instead of blending decades of regimes.
      const curYear = new Date().getUTCFullYear();
      const cutYear = curYear - MAX_YEARS; // e.g. 2016 for a 2026 view (inclusive of 2016 Dec → 2017 Jan return)
      const bars = allBars.filter((b) => parseInt(String(b.time).slice(0, 4), 10) >= cutYear);
      if (!bars.length) { setStats(null); return; }
      const byMonthRet: number[][] = Array.from({ length: 12 }, () => []);
      // monthly close series → monthly returns bucketed by calendar month
      const monthly: { ym: string; c: number }[] = [];
      bars.forEach((b) => { const ym = String(b.time).slice(0, 7); const last = monthly[monthly.length - 1]; if (!last || last.ym !== ym) monthly.push({ ym, c: b.c }); else last.c = b.c; });
      for (let i = 1; i < monthly.length; i++) { const m = parseInt(monthly[i].ym.slice(5, 7)) - 1; byMonthRet[m].push((monthly[i].c - monthly[i - 1].c) / monthly[i - 1].c); }
      setStats(byMonthRet.map((a) => (a.length
        ? { avg: (a.reduce((x, y) => x + y, 0) / a.length) * 100, wr: (a.filter((x) => x > 0).length / a.length) * 100, n: a.length }
        : null)));
    }).catch(() => setStats(null));
    return () => { dead = true; };
  }, [symbol]);

  if (!stats) return null;
  const max = Math.max(...stats.map((s) => (s ? Math.abs(s.avg) : 0)), 1);
  const now = new Date().getUTCMonth();
  return (
    <div className="card" style={{ borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, font: "600 10px/1 var(--font-ui)", letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ stroke: "var(--brand-2)", fill: "none", strokeWidth: 2 }}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
        {t("seasonalityTitle")}
        <span style={{ marginLeft: "auto", font: "600 9px/1 var(--font-num)", fontVariantNumeric: "tabular-nums", letterSpacing: ".04em", color: "var(--text-dim)" }}>{MAX_YEARS}y</span>
      </div>
      {/* every bar shares the bottom baseline (align-items:flex-end) and grows up; sign only drives color */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 66 }}>
        {stats.map((s, i) => {
          const up = (s?.avg ?? 0) >= 0;
          const tip = s == null
            ? `${MN[i]} · ${t("noSamples")}`
            : `${MN[i]} · ${up ? "+" : ""}${s.avg.toFixed(1)}% ${t("avgShort")} · ${t("winRateShort")} ${s.wr.toFixed(0)}% · n=${s.n}`;
          return (
            <div key={i} title={tip}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "default" }}>
              <div style={{ width: "100%", height: 52, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                {s == null
                  ? <div style={{ height: 2, width: "100%", background: "var(--line-3)", borderRadius: 2, opacity: 0.7 }} />
                  : <div style={{ width: "100%", height: `${Math.max(4, (Math.abs(s.avg) / max) * 100)}%`, minHeight: 2, background: up ? "var(--up)" : "var(--down)", borderRadius: "2px 2px 0 0", opacity: i === now ? 1 : 0.55, outline: i === now ? "1px solid var(--brand-2)" : "none" }} />}
              </div>
              <span style={{ fontSize: 9, color: i === now ? "var(--brand-2)" : "var(--text-dim)", marginTop: 4 }}>{M[i]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>{t("seasonalityFoot").replace("{sym}", symbol)}</div>
      {onOpenPane && (
        <button className="sa-more-btn" style={{ marginTop: 10 }} onClick={onOpenPane}>{t("moreSeasonals")} ›</button>
      )}
    </div>
  );
}
