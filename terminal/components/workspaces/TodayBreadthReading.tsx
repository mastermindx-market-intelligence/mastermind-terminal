"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { breadthExpiresAt, marketBreadthPayload, type BreadthSession, type MarketBreadth } from "@/lib/shared-shell/marketBreadth";
import { freshnessLabel, readingFreshness } from "@/lib/shared-shell/readingFreshness";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import today from "./TodayWorkspace.module.css";

type Props = { ownerKey: string; scope: { current: AbortController | null }; onUnauthenticated: () => void };
type Phase = "loading" | "ready" | "unavailable" | "ended";

const BREADTH_URL = "/api/market-breadth";

const COPY = {
  en: {
    label: "S&P 500 breadth",
    loading: "Checking breadth…",
    unavailable: "Breadth reading unavailable",
    advancing: (n: number) => `${n}% advancing`,
    above200: (n: number) => `${n}% above 200-day`,
    delayed: (n: number) => `${n}-min delayed`,
    zone: "ET",
    session: { pre: "Pre-market", rth: "Market open", post: "After hours", closed: "Market closed" } as Record<BreadthSession, string>,
    reason: {
      session_closed: "Market closed — live breadth resumes at the next session",
      stale: "Live source is behind",
      coverage: "Live coverage incomplete",
      feed: "Live feed degraded",
      other: "Live breadth not usable",
    },
  },
  zh: {
    label: "标普 500 市场广度",
    loading: "正在读取市场广度…",
    unavailable: "市场广度读数暂不可用",
    advancing: (n: number) => `${n}% 上涨`,
    above200: (n: number) => `${n}% 位于 200 日均线上方`,
    delayed: (n: number) => `延迟 ${n} 分钟`,
    zone: "（美东）",
    session: { pre: "盘前", rth: "盘中", post: "盘后", closed: "休市" } as Record<BreadthSession, string>,
    reason: {
      session_closed: "休市——下一交易日恢复实时广度",
      stale: "实时来源滞后",
      coverage: "实时覆盖不完整",
      feed: "实时数据源异常",
      other: "实时广度暂不可用",
    },
  },
};

const CLOCK = {
  en: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  zh: new Intl.DateTimeFormat("zh-CN", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
};

/** engine/live_breadth.py names why the live reading may not replace the nightly board; the
 *  cell says which family of reason it is, never the numbers it declined to vouch for. */
export function breadthReason(reason: string | null, lang: "en" | "zh"): string {
  const r = COPY[lang].reason;
  if (reason === "session_closed") return r.session_closed;
  if (reason === "source_stale" || reason === "no_source_clock") return r.stale;
  if (reason === "coverage_low" || reason === "no_coverage" || reason === "tiers_incomplete") return r.coverage;
  if (reason?.startsWith("feed_")) return r.feed;
  return r.other;
}

export function breadthClock(asof: string, lang: "en" | "zh"): string | null {
  const t = Date.parse(asof);
  if (!Number.isFinite(t)) return null;
  const c = COPY[lang];
  return lang === "zh" ? `${CLOCK.zh.format(new Date(t))}${c.zone}` : `${CLOCK.en.format(new Date(t))} ${c.zone}`;
}

/** One extra, non-link cell in the Today source-readings strip: the S&P 500 tier of Macro's
 *  live breadth file, read through the session-gated /api/market-breadth proxy. */
export default function TodayBreadthReading({ ownerKey, scope, onUnauthenticated }: Props) {
  const { lang } = useLang();
  const c = COPY[lang];
  // The answer is remembered with the owner it was read for, so a new owner starts as loading
  // without a synchronous reset inside the effect.
  const [answer, setAnswer] = useState<{ owner: string; phase: Phase; reading: MarketBreadth | null } | null>(null);
  const phase: Phase = answer?.owner === ownerKey ? answer.phase : "loading";
  const reading = answer?.owner === ownerKey ? answer.reading : null;
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => { onUnauthenticatedRef.current = onUnauthenticated; });

  useEffect(() => {
    let live = true;
    const settle = (next: Phase, value: MarketBreadth | null = null) => { if (live) setAnswer({ owner: ownerKey, phase: next, reading: value }); };
    (async () => {
      try {
        const { response, value } = await readingJson(scope, BREADTH_URL);
        if (!live) return;
        if (response.status === 401) { settle("ended"); onUnauthenticatedRef.current(); return; }
        const parsed = response.ok ? marketBreadthPayload(value, new Date()) : null;
        settle(parsed ? "ready" : "unavailable", parsed);
      } catch {
        settle("unavailable");
      }
    })();
    return () => { live = false; };
  }, [ownerKey, scope]);

  // A tab left open must not keep a live reading past its window: when the window closes the
  // reading is re-checked on the reader's clock and withheld like any other old file. A timer
  // may not count while the machine sleeps, so the tab coming back into view re-checks too.
  useEffect(() => {
    const at = phase === "ready" && reading ? breadthExpiresAt(reading) : null;
    if (at === null || !reading) return;
    const recheck = () => {
      const next = marketBreadthPayload(reading, new Date());
      setAnswer({ owner: ownerKey, phase: next ? "ready" : "unavailable", reading: next });
    };
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() > at) recheck(); };
    const id = setTimeout(recheck, Math.max(0, at - Date.now()) + 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [phase, reading, ownerKey]);

  if (phase === "ended") return null;
  if (phase !== "ready" || !reading) {
    return (
      <div className={`${today.reading} ${today.readingStatic}`} aria-busy={phase === "loading"}>
        <span className={today.readingLabel}>{c.label}</span>
        <strong className={today.readingQuiet}>{phase === "loading" ? c.loading : c.unavailable}</strong>
      </div>
    );
  }

  const large = reading.large;
  const clock = breadthClock(reading.asof, lang);
  const usable = reading.usable && large && large.adv_pct !== null;
  if (!usable) {
    // A withheld reading keeps only its own timestamp: the session word, the delay and the age
    // all describe a live reading, which this is not.
    return (
      <div className={`${today.reading} ${today.readingStatic}`} data-breadth="withheld">
        <span className={today.readingLabel}>{c.label}</span>
        <strong className={today.readingQuiet}>{breadthReason(reading.unusable_reason, lang)}</strong>
        {clock && <span className={today.readingClock}>{clock}</span>}
      </div>
    );
  }
  const age = readingFreshness(reading.asof, new Date());
  return (
    <div className={`${today.reading} ${today.readingStatic}`} data-breadth="live">
      <span className={today.readingLabel}>{c.label}</span>
      <strong>{c.advancing(Math.round(large.adv_pct as number))}</strong>
      {large.pa200 !== null && <span className={today.readingNote}>{c.above200(Math.round(large.pa200))}</span>}
      <span className={today.readingClock}>
        {[clock, c.session[reading.session], reading.delay_min ? c.delayed(reading.delay_min) : null].filter(Boolean).join(" · ")}
      </span>
      <span className={today.readingAge} data-kind={age.kind}>{freshnessLabel(age, lang)}</span>
    </div>
  );
}
