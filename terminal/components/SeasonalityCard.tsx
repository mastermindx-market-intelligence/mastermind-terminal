"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLang, useT } from "@/lib/i18n";
import { getBars } from "@/lib/fund";
import { MAX_YEARS } from "@/lib/seasonal";
import styles from "./SeasonalityCard.module.css";

type MonthStat = { avg: number; wr: number; n: number } | null;

const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(2020, index, 1)));

// Average monthly return from history → a TrendSpider-style seasonality read (display-only).
// Every month's bar grows UP from a shared baseline (negative months are red, not inverted).
export default function SeasonalityCard({ symbol, onOpenPane }: { symbol: string; onOpenPane?: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const [stats, setStats] = useState<MonthStat[] | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getUTCMonth());
  const monthRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    return MONTHS.map((month) => formatter.format(month));
  }, [locale]);
  const monthMarks = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: "narrow", timeZone: "UTC" });
    return MONTHS.map((month) => formatter.format(month));
  }, [locale]);

  useEffect(() => {
    let dead = false;
    // getBars routes through dataCache (dedupes with the chart's OHLC fetch — no third raw fetch)
    getBars(symbol).then((allBars) => {
      if (dead || !allBars.length) { setStats(null); return; }
      // 10y lookback (MAX_YEARS): keep only bars from the last N complete years +
      // the current YTD, so the mini read matches the full Seasonals page default.
      const curYear = new Date().getUTCFullYear();
      const cutYear = curYear - MAX_YEARS;
      const bars = allBars.filter((b) => parseInt(String(b.time).slice(0, 4), 10) >= cutYear);
      if (!bars.length) { setStats(null); return; }
      const byMonthRet: number[][] = Array.from({ length: 12 }, () => []);
      const monthly: { ym: string; c: number }[] = [];
      bars.forEach((b) => {
        const ym = String(b.time).slice(0, 7);
        const last = monthly[monthly.length - 1];
        if (!last || last.ym !== ym) monthly.push({ ym, c: b.c });
        else last.c = b.c;
      });
      for (let i = 1; i < monthly.length; i++) {
        const month = parseInt(monthly[i].ym.slice(5, 7), 10) - 1;
        byMonthRet[month].push((monthly[i].c - monthly[i - 1].c) / monthly[i - 1].c);
      }
      setStats(byMonthRet.map((returns) => (returns.length
        ? {
          avg: (returns.reduce((sum, value) => sum + value, 0) / returns.length) * 100,
          wr: (returns.filter((value) => value > 0).length / returns.length) * 100,
          n: returns.length,
        }
        : null)));

    }).catch(() => setStats(null));
    return () => { dead = true; };
  }, [symbol]);

  if (!stats) return null;

  const max = Math.max(...stats.map((stat) => (stat ? Math.abs(stat.avg) : 0)), 1);
  const currentMonth = new Date().getUTCMonth();
  const describeMonth = (index: number) => {
    const stat = stats[index];
    if (stat == null) return `${monthNames[index]} · ${t("noSamples")}`;
    const sign = stat.avg >= 0 ? "+" : "";
    return `${monthNames[index]} · ${sign}${stat.avg.toFixed(1)}% ${t("avgShort")} · ${t("winRateShort")} ${stat.wr.toFixed(0)}% · n=${stat.n}`;
  };
  const selectedStat = stats[selectedMonth];
  const selectedDetail = describeMonth(selectedMonth);
  const selectedDirection = selectedStat == null ? "empty" : selectedStat.avg >= 0 ? "up" : "down";
  const sourceFoot = t("seasonalityFoot").replace("{sym}", symbol);
  const footParts = sourceFoot.split(" · ");
  const contextFoot = footParts.length >= 3
    ? [footParts[0], ...footParts.slice(2)].join(" · ")
    : sourceFoot;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + 11) % 12;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % 12;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 11;
    if (next == null) return;
    event.preventDefault();
    setSelectedMonth(next);
    monthRefs.current[next]?.focus();
  }

  return (
    <div className={`card ${styles.card}`} data-testid="seasonality-card">
      <div className={styles.header}>
        <svg className={styles.icon} width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        {t("seasonalityTitle")}
        <span className={styles.years}>{MAX_YEARS}y</span>
      </div>
      <div className={styles.plot} role="group" aria-label={t("seasonalityTitle")}>
        {stats.map((stat, index) => {
          const direction = stat == null ? "empty" : stat.avg >= 0 ? "up" : "down";
          const detail = describeMonth(index);
          const selected = index === selectedMonth;
          return (
            <button
              key={index}
              ref={(node) => { monthRefs.current[index] = node; }}
              type="button"
              className={styles.month}
              data-testid={`seasonality-month-${index}`}
              data-current={index === currentMonth ? "true" : "false"}
              data-selected={selected ? "true" : "false"}
              title={detail}
              aria-label={detail}
              aria-pressed={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedMonth(index)}
              onFocus={() => setSelectedMonth(index)}
              onMouseEnter={() => setSelectedMonth(index)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <span className={styles.barTrack} aria-hidden="true">
                {stat == null ? (
                  <span className={styles.emptyBar} />
                ) : (
                  <span
                    className={styles.bar}
                    data-direction={direction}
                    style={{ height: `${Math.max(4, (Math.abs(stat.avg) / max) * 100)}%` }}
                  />
                )}
              </span>
              <span className={styles.monthMark}>{monthMarks[index]}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.detailControls}>
        <select
          className={styles.monthSelect}
          data-testid="seasonality-month-select"
          aria-label={t("seasonalityTitle")}
          value={selectedMonth}
          onChange={(event) => setSelectedMonth(Number(event.target.value))}
        >
          {monthNames.map((month, index) => (
            <option key={index} value={index}>{month}</option>
          ))}
        </select>
        <output
          className={styles.detail}
          data-testid="seasonality-detail"
          data-direction={selectedDirection}
          aria-live="polite"
          aria-atomic="true"
        >
          {selectedDetail}
        </output>
      </div>
      <div className={styles.context} data-testid="seasonality-context">{contextFoot}</div>
      {onOpenPane && (
        <button className="sa-more-btn" style={{ marginTop: 10 }} onClick={onOpenPane}>
          {t("moreSeasonals")} ›
        </button>
      )}
    </div>
  );
}
