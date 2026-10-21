"use client";
import { exposureMapT } from "./exposureMapStrings";
import { useEffect, useMemo, useState } from "react";
import { ema, sma } from "@/lib/indicatorMath";
import { getOhlcView } from "@/lib/dataCache";
import { etDisplay } from "@/lib/intradaySources";
import type { Bar6 } from "@/lib/intradayShared";
import type { SessionOhlcBar } from "@/lib/sessionBars";
import { closedDailyBars, closedIntradayBars, confirmedExposureDivergence, latestExposureBarClose, type ExposureTimeframe } from "@/lib/exposureDivergence";
import { useLang } from "@/lib/i18n";
import styles from "./ExposureMap.module.css";

type Read = { root: string; daily: SessionOhlcBar[] | null; intraday: Bar6[] | null; staleDaily: boolean; attempt: number };
const FRAMES: ExposureTimeframe[] = ["5m", "30m", "2h", "D", "W"];
const stamp = (t: number | null) => t == null ? "—" : `${new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ")} ET`;

/** Snapshot reads through existing bar owners; no quote subscription, store, alert, or backtest. */
export type ExposureAverage = { label: string; price: number; observedAt: number };
export default function ExposureDivergence({ root, onAverages }: { root: string; onAverages?: (root: string, values: ExposureAverage[]) => void }) {
  const { lang } = useLang(); const zh = lang === "zh"; const t = exposureMapT(lang);
  const [read, setRead] = useState<Read | null>(null);
  const [request, refresh] = useState(0);
  const loading = read?.root !== root || read.attempt !== request;
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let current = true; const controller = new AbortController();
    void Promise.allSettled([
      getOhlcView(root),
      fetch(`/api/intraday?sym=${encodeURIComponent(root)}&tf=5m&ext=0`, { cache: "no-store", signal: controller.signal }).then(async (r) => {
        const value = await r.json();
        if (!r.ok || value?.error || value?.t !== root || value?.tf !== "5m" || !Array.isArray(value?.bars)) throw new Error("BAR_SOURCE_UNAVAILABLE");
        return value.bars as Bar6[];
      }),
    ]).then(([daily, intraday]) => {
      if (!current) return;
      const data = daily.status === "fulfilled" && daily.value.status === "data" ? daily.value : null;
      const rows = Array.isArray(data?.data?.bars) ? data.data.bars.slice(-700) : null;
      const symbol = data?.data?.symbol ?? data?.data?.t ?? data?.data?.sym;
      setRead({ root, daily: rows && (symbol == null || symbol === root) ? rows.map((b: unknown[]) => ({ time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })) as SessionOhlcBar[] : null,
        intraday: intraday.status === "fulfilled" ? intraday.value : null, staleDaily: !!data?.stale, attempt: request });
      setNow(Date.now());
    });
    return () => { current = false; controller.abort(); };
  }, [root, request]);
  const rows = useMemo(() => FRAMES.map((tf) => {
    if (!read || read.root !== root || read.attempt !== request) return { tf, result: null };
    try {
      const clock = etDisplay(now).epoch;
      const bars = tf === "D" || tf === "W" ? read.daily && closedDailyBars(read.daily, tf, clock)
        : read.intraday && closedIntradayBars(read.intraday, tf, clock);
      if (!bars?.length) return { tf, result: null };
      const expected = latestExposureBarClose(tf, clock);
      const stale = expected == null || bars.at(-1)!.closedAtDisplay < expected || ((tf === "D" || tf === "W") && read.staleDaily);
      return { tf, result: confirmedExposureDivergence(bars, hidden, stale) };
    } catch { return { tf, result: null }; }
  }), [read, root, now, hidden, request]);
  const averages = useMemo(() => {
    const values: ExposureAverage[] = [];
    if (!read || read.root !== root || read.attempt !== request) return values;
    const clock = etDisplay(now).epoch;
    try {
      const daily = read.daily && closedDailyBars(read.daily, "D", clock);
      if (daily?.length) {
        const close = daily.map(b => b.c), at = daily.at(-1)!.closedAtDisplay;
        for (const [label, price] of [["SMA 5 · D", sma(close, 5).at(-1)], ["EMA 21 · D", ema(close, 21).at(-1)], ["SMA 55 · D", sma(close,55).at(-1)]] as const) {
          if (price != null && Number.isFinite(price)) values.push({label,price,observedAt:at});
        }
      }
    } catch { /* invalid daily bars cannot seed reference levels */ }
    try {
      const bars = read.intraday && closedIntradayBars(read.intraday, "5m", clock);
      const price = bars && sma(bars.map(b => b.c),34).at(-1);
      if (bars?.length && price != null && Number.isFinite(price)) values.push({label:"SMA 34 · 5m",price,observedAt:bars.at(-1)!.closedAtDisplay});
    } catch { /* independent intraday source status */ }
    return values;
  }, [read,root,request,now]);
  useEffect(() => { onAverages?.(root, averages); }, [root, averages, onAverages]);
  const kinds = zh ? { bull: "常规看涨", bear: "常规看跌", hiddenBull: "隐藏看涨", hiddenBear: "隐藏看跌" } : { bull: "Regular bullish", bear: "Regular bearish", hiddenBull: "Hidden bullish", hiddenBear: "Hidden bearish" };
  const states = zh ? { none: "无已确认背离", insufficient: "历史不足", stale: "数据过时", confirmed: "已确认" } : { none: "No confirmed divergence", insufficient: "Insufficient history", stale: "Stale bars", confirmed: "Confirmed" };
  const directions = new Set(rows.flatMap(({ result }) => result?.state === "confirmed" && result.event ? [result.event.kind.toLowerCase().includes("bull") ? "bull" : "bear"] : []));
  return <section className={styles.divergence} data-testid="exposure-divergence"><div className={styles.divergenceHeader}><span className={styles.eyebrow}>{t("confirmedMomentum")}</span><button type="button" disabled={loading} onClick={() => refresh(n => n + 1)}>{loading ? (t("reading")) : (t("refresh"))}</button></div>
    <div className={styles.momentumGrid}>{rows.map(({tf,result}) => <div key={tf}><span>{tf === "D" ? (t("daily")) : tf === "W" ? (t("weekly")) : tf}</span><strong data-sign={result?.event ? result.event.kind.toLowerCase().includes("bull") ? "positive" : "negative" : undefined}>{result?.event ? kinds[result.event.kind] : result?.state === "none" ? (t("noDivergence")) : result ? states[result.state] : (t("unavailable2"))}</strong></div>)}</div>
    <details><summary>{t("methodConfirmationTimesPriceSources")}</summary>
    <div className={styles.toolbar}><button type="button" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{t("includeHiddenDivergence")}</button><button type="button" disabled={loading} onClick={() => refresh((n) => n + 1)}>{loading ? (t("reading2")) : (t("refreshPriceSnapshot"))}</button></div>
    <p className={styles.note}>{t("rsi14Wing2MaxSpan60Completed")}</p>
    {directions.size > 1 && <p className={styles.warning}>{t("timeframesConflictNoCombinedTradingSignalIsImplied")}</p>}
    <div className={styles.scroll}><table><thead><tr><th>{t("timeframe2")}</th><th>{t("state")}</th><th>{t("confirmedAtBarsSince")}</th><th>{t("latestClose")}</th></tr></thead><tbody>{rows.map(({ tf, result }) => <tr key={tf}><td>{tf}</td><td>{result?.event ? kinds[result.event.kind] : result ? states[result.state] : t("unavailable2")}</td><td>{result?.event ? `${stamp(result.event.confirmedAtDisplay)} · ${result.event.ageBars}` : "—"}</td><td>{stamp(result?.latestClose ?? null)}{result?.shortened ? (t("shortenedSession")) : ""}</td></tr>)}</tbody></table></div>
    <p className={styles.note}>{t("rsi14W2S60V1CurrentAdjustedPriceSnapshots")}</p>
  </details></section>;
}
