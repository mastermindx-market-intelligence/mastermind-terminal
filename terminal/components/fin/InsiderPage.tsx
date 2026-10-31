"use client";
/**
 * InsiderPage — the "Insider" tab (Insider Power). Verdict-first display of the
 * Macro pipeline's insider posture, on the Mastermind v6 design system:
 *   1. Verdict header — a plain-word STATE (state chip + one sentence) with an
 *      evidence strip (Buyers · Sellers · Net · Window · Last trade age) in mono.
 *   2. ArcGauge (0..100, 50 = neutral) as SECONDARY evidence — neutral grey when
 *      the tape is routine so "no signal" looks like no signal.
 *   3. Insider buy- vs sell-volume bars overlaid on the price line (per month).
 *   4. Recent open-market Form-4 trades with tinted type pills.
 *
 * SCORING IS ENGINE-OWNED. It is NOT re-derived here — the Macro pipeline
 * (engine/insider_power.py) computes score/signal/confidence and exports it per
 * ticker as <SYM>.insider.json. This file is display-only and NEVER escalates
 * client-side. The one client transform below is a temporary DE-ESCALATION shim
 * (routine sell-only → NO SIGNAL) that fires ONLY until the engine v2 payloads
 * carrying `routine_only`/`signal="NEUTRAL"` bake — it can only soften a
 * bearish verdict to neutral, never the reverse. Display / informational; not
 * investment advice.
 *
 * Props: {sym, bars?, zh}. Self-fetches its own insider payload (like
 * TechnicalsPage self-fetches intraday); `bars` (daily OHLC, already in the
 * shell) supplies the overlaid price line — absent bars just drop the line.
 */
import { memo, useEffect, useMemo, useState } from "react";
import type { Bar, Insider } from "../../lib/fund";
import { getJSONResult } from "../../lib/dataCache";
import { marketOf } from "../../lib/markets";
import { fmtCur, fmtNum, fmtDate, pick } from "../../lib/finFormat";
import { ComboChart, type Series } from "./FinCharts";
import { ArcGauge } from "../ui/ArcGauge";
import { Disclaimer } from "./ForecastPage";

interface InsiderPageProps {
  sym: string;
  bars?: Bar[];
  zh?: boolean;
}

/** A resolved verdict: the plain-word state, its color family, and one sentence. */
interface Verdict {
  /** State chip word (bilingual, plain). */
  word: string;
  /** ArcGauge state → picks ONE color (never a red→green gradient). */
  gauge: "bull" | "bear" | "warn" | "neutral";
  /** Chip color class: up / down / neutral. */
  tone: "up" | "down" | "neu";
  /** One plain-word sentence explaining the state. */
  sentence: string;
  /** True only on the pre-v2 shim path: the payload's score is the legacy
   *  saturated value (e.g. 3 for routine sell-only) — park the arc at neutral
   *  and hide the numeral instead of contradicting the "No signal" chip. */
  staleScore?: boolean;
  /** Suppress the confidence chip: legacy payload confidence is the discredited
   *  sellers>=3 heuristic — showing "High confidence" would amplify it. */
  hideConf?: boolean;
}

/**
 * resolveVerdict — engine-owned posture → display verdict. Reads the engine's
 * `signal`/`routine_only`/`posture_reason` when present; otherwise falls back to
 * the legacy score bands. The ONLY client transform is the de-escalation shim
 * (commented below), which softens a routine sell-only tape to NO SIGNAL — it
 * never escalates.
 */
function resolveVerdict(d: Insider, zh: boolean): Verdict {
  // ── TEMPORARY de-escalation shim (remove once engine v2 payloads carry
  // `routine_only`/`signal="NEUTRAL"`): a name with NO buyers, a sub-40 score,
  // and no v2 posture fields is routine equity-comp selling, not a bearish
  // signal. This can only soften bearish→neutral; scoring stays engine-owned. ──
  const hasV2 = d.routine_only != null || d.posture_reason != null;
  const shimNeutral = !hasV2 && d.buyers === 0 && d.score < 40;
  const routine = d.routine_only === true || shimNeutral;

  if (routine) {
    return {
      staleScore: shimNeutral,
      word: pick(zh, "No signal", "无信号"),
      gauge: "neutral",
      tone: "neu",
      sentence:
        d.posture_reason && (zh ? d.posture_reason_zh : d.posture_reason)
          ? pick(zh, d.posture_reason, d.posture_reason_zh)
          : pick(
              zh,
              "Insiders only sold in the window — routine at equity-comp firms. No informative buy/sell tilt.",
              "窗口内内部人仅有卖出 — 在以股权激励为主的公司属常态，无明显买卖倾向。",
            ),
    };
  }

  if (d.signal === "BUY") {
    return {
      word: pick(zh, "Bullish — insider buying", "看多 — 内部人买入"),
      gauge: "bull",
      tone: "up",
      sentence: pick(
        zh,
        `${d.buyers} insider${d.buyers === 1 ? "" : "s"} bought on the open market this window.`,
        `本窗口内 ${d.buyers} 名内部人在公开市场买入。`,
      ),
    };
  }

  if (d.signal === "SELL") {
    // Engine says SELL. The intensity word must come from the ENGINE's posture, never a
    // client-side re-derivation (a sellers>=3 "cluster" claim here would resurrect the exact
    // discredited heuristic the v2 engine fix removes). Legacy (pre-v2) payloads carry the
    // old saturating score AND its sellers>=3 confidence — present those as a plain "tilt"
    // with the confidence chip suppressed (de-escalation only; the engine read still shows).
    return {
      word: hasV2
        ? pick(zh, "Bearish — informative selling", "看空 — 有信息含量的卖出")
        : pick(zh, "Bearish tilt", "看空倾向"),
      gauge: "bear",
      tone: "down",
      hideConf: !hasV2,
      sentence:
        hasV2 && d.posture_reason
          ? pick(zh, d.posture_reason, d.posture_reason_zh || d.posture_reason)
          : pick(
              zh,
              `${d.sellers} insider seller${d.sellers === 1 ? "" : "s"} vs ${d.buyers} buyer${d.buyers === 1 ? "" : "s"} on the open market this window.`,
              `本窗口内公开市场有 ${d.sellers} 名卖方，${d.buyers} 名买方。`,
            ),
    };
  }

  // Engine NEUTRAL (already de-escalated upstream).
  return {
    word: pick(zh, "No signal", "无信号"),
    gauge: "neutral",
    tone: "neu",
    sentence: pick(
      zh,
      "No informative buy/sell tilt in the window.",
      "窗口内无明显买卖倾向。",
    ),
  };
}

/** "N months ago" plain-word age of the last trade (or a dash). */
function ageWords(days: number | null, zh: boolean): string {
  if (days == null) return "—";
  if (days < 45) return pick(zh, `${days}d ago`, `${days}天前`);
  const mo = Math.round(days / 30);
  if (mo < 24) return pick(zh, `${mo}mo ago`, `${mo}个月前`);
  const yr = Math.round(days / 365);
  return pick(zh, `${yr}y ago`, `${yr}年前`);
}

function InsiderPage({ sym, bars = [], zh = false }: InsiderPageProps) {
  const [data, setData] = useState<Insider | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setData(null);
    // Keep the cache owner's absence/unavailable distinction: a failed read
    // cannot establish that no filings exist or become a cached missing symbol.
    getJSONResult("/data/" + sym + ".insider.json")
      .then((result) => {
        if (!alive) return;
        setData(result.status === "data" ? result.data as Insider : null);
        setState(result.status === "data" ? "ready" : result.status === "absent" ? "empty" : "error");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [sym, retryNonce]);

  // month ("YYYY-MM") → last daily close in that month, for the overlaid price line.
  const monthClose = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bars) {
      const key = String(b.time).slice(0, 7);
      if (isFinite(b.c)) m.set(key, b.c); // bars are chronological → last wins = month close
    }
    return m;
  }, [bars]);

  if (state === "loading") {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <span className="fin-empty-title">{pick(zh, "Loading insider data…", "正在加载内部交易数据…")}</span>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="alert">
          <span className="fin-empty-title">{pick(zh, "Insider data unavailable", "暂时无法加载内部交易数据")}</span>
          <span className="fin-empty-why">
            {pick(zh, `Could not load the Form 4 data for ${sym}. Try again.`, `无法加载 ${sym} 的 Form 4 数据。请重试。`)}
          </span>
          <button className="btn btn-ghost" onClick={() => setRetryNonce((value) => value + 1)}>
            {pick(zh, "Retry", "重试")}
          </button>
        </div>
      </div>
    );
  }

  if (state === "empty" || !data) {
    // Honest empty: Form 4 is a US SEC dataset, so a non-US listing is NOT
    // "missing data" — it is out of coverage. Say which one it is.
    const nonUS = marketOf(sym) !== "us";
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <span className="fin-empty-title">{pick(zh, "No insider data", "暂无内部交易数据")}</span>
          <span className="fin-empty-why">
            {nonUS
              ? pick(
                  zh,
                  `Form 4 insider filings are a US SEC dataset. ${sym} is listed outside the US, so no Form 4 record exists for it.`,
                  `Form 4 内部人申报属于美国 SEC 数据集。${sym} 在美国以外上市，因此没有 Form 4 记录。`,
                )
              : pick(
                  zh,
                  `No open-market Form 4 buys or sells have been filed for ${sym} in the covered period.`,
                  `覆盖期内 ${sym} 没有公开市场 Form 4 买入或卖出申报。`,
                )}
          </span>
        </div>
      </div>
    );
  }

  const d = data;
  const verdict = resolveVerdict(d, zh);
  // Section rail: the verdict section IS directional, so its rail carries the
  // same tone the ArcGauge already resolved (grey when there is no signal).
  const verdictRail =
    verdict.tone === "up" ? "var(--up)" : verdict.tone === "down" ? "var(--down)" : "var(--muted)";

  // ── asof quarter label — SEC publishes bulk Form-4 data one quarter at a time,
  // roughly 45 days after quarter-end. Show "Q1 2026" rather than just the ISO date
  // so the user knows this is SEC filing data, not a real-time feed.
  const asofQLabel = (() => {
    const d2 = new Date(d.asof);
    const y = d2.getUTCFullYear();
    const m = d2.getUTCMonth(); // 0-indexed
    const q = Math.floor(m / 3) + 1;
    return `Q${q} ${y}`;
  })();

  // ── 18-month display window (don't present ancient trades as the story) ──
  const WINDOW_DAYS = 548; // ~18 months
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  // Trades are newest-first; filter to window. Use filing date (t.date) as the
  // public-disclosure anchor — trade_date can be days earlier.
  const recentTrades = d.trades.filter((t) => t.date >= cutoffISO);
  const mostRecentDate = d.trades.length > 0 ? d.trades[0].date : null;

  // Age of the most recent trade — prefer the engine field, else derive from dates.
  const lastTradeAgeD =
    d.last_trade_age_d != null
      ? d.last_trade_age_d
      : mostRecentDate
        ? Math.floor((Date.now() - new Date(mostRecentDate).getTime()) / 86_400_000)
        : null;
  const isQuiet = recentTrades.length === 0;

  // ── buy/sell volume bars + price line, limited to the same 18-month window ──
  const cutoffMonth = cutoffISO.slice(0, 7); // "YYYY-MM"
  const visibleSeries = d.series.filter((s) => s.month >= cutoffMonth);
  const labels = visibleSeries.map((s) => s.month.slice(2).replace("-", "/")); // "24/04"
  const buyVals = visibleSeries.map((s) => (s.buy_usd > 0 ? s.buy_usd : null));
  const sellVals = visibleSeries.map((s) => (s.sell_usd > 0 ? -s.sell_usd : null)); // negative → draws below zero
  const priceVals = visibleSeries.map((s) => monthClose.get(s.month) ?? null);
  const hasAnyVol = buyVals.some((v) => v != null) || sellVals.some((v) => v != null);
  // 70% alpha directional fills (v6): translucent --up/--down that flip with the
  // east red-up theme via the -rgb triplets.
  const barSeries: Series[] = [
    { name: pick(zh, "Buy volume", "买入额"), values: buyVals, color: "rgba(var(--up-rgb),.7)" },
    { name: pick(zh, "Sell volume", "卖出额"), values: sellVals, color: "rgba(var(--down-rgb),.7)" },
  ];
  const priceSeries: Series = { name: pick(zh, "Price", "价格"), values: priceVals, color: "var(--text-2)" };

  const netSign = d.net_usd < 0 ? "−" : d.net_usd > 0 ? "+" : "";
  const netTone = d.net_usd > 0 ? "up" : d.net_usd < 0 ? "down" : "";

  return (
    <div className="fin-body">
      {/* ── Verdict header: state chip + sentence + ArcGauge + evidence strip ── */}
      <div className="fin-sec">
        <div className="fin-eyebrow">{pick(zh, "Form 4 · open market", "Form 4 · 公开市场")}</div>
        <div
          className="fin-sec-h fin-rail fin-rule"
          style={{ "--rail": verdictRail } as React.CSSProperties}
        >
          {pick(zh, "Insider Power", "内部人操作力度")}
        </div>
        <div className="fin-insider-verdict">
          <div className="fin-insider-verdict-main">
            <div className="fin-insider-verdict-row">
              <span className={`fin-insider-state ${verdict.tone}`}>{verdict.word}</span>
              {d.confidence !== "None" && verdict.tone !== "neu" && !verdict.hideConf && (
                <span className="fin-insider-conf">
                  {pick(zh, d.confidence + " confidence", d.confidence + " 置信度")}
                </span>
              )}
            </div>
            <p className="fin-insider-sentence">{verdict.sentence}</p>

            {/* Evidence strip — mono values, tabular */}
            <div className="fin-insider-ev">
              <div className="fin-insider-evcell">
                <span className="k">{pick(zh, "Buyers", "买方")}</span>
                <span className="v up">{d.buyers}</span>
              </div>
              <div className="fin-insider-evcell">
                <span className="k">{pick(zh, "Sellers", "卖方")}</span>
                <span className="v down">{d.sellers}</span>
              </div>
              <div className="fin-insider-evcell">
                <span className="k">{pick(zh, "Net", "净额")}</span>
                <span className={`v ${netTone}`}>{netSign + fmtCur(Math.abs(d.net_usd), "USD", { decimals: 0 })}</span>
              </div>
              <div className="fin-insider-evcell">
                <span className="k">{pick(zh, "Window", "窗口")}</span>
                <span className="v">{Math.round(d.window_days / 30)}{pick(zh, "mo", "个月")}</span>
              </div>
              <div className="fin-insider-evcell">
                <span className="k">{pick(zh, "Last trade", "最近交易")}</span>
                <span className="v">{ageWords(lastTradeAgeD, zh)}</span>
              </div>
            </div>
          </div>

          {/* ArcGauge — secondary evidence, neutral grey when routine */}
          <div className="fin-insider-gauge">
            <ArcGauge
              value={verdict.staleScore ? 50 : Math.max(0, Math.min(100, d.score))}
              state={verdict.gauge}
              size={148}
              showValue={!verdict.staleScore}
              centerLabel={
                verdict.staleScore
                  ? pick(zh, "No material signal", "无实质信号")
                  : undefined
              }
              label={pick(zh, "Insider Power", "操作力度")}
              sublabel={pick(zh, "50 = neutral", "50 = 中性")}
            />
          </div>
        </div>
      </div>

      {/* ── Buy/Sell volume overlaid on price ── */}
      <div className="fin-sec">
        <div className="fin-eyebrow">{pick(zh, "Activity", "交易活动")}</div>
        <div
          className="fin-sec-h fin-rail fin-rule"
          style={{ "--rail": "var(--brand)" } as React.CSSProperties}
        >
          {pick(zh, "Insider buy / sell volume vs price", "内部买卖量 vs 价格")}
        </div>
        {hasAnyVol ? (
          <div className="fin-insider-volchart">
            <ComboChart
              labels={labels}
              bars={barSeries}
              line={priceSeries}
              fmtBar={(v) => fmtCur(v, "USD", { decimals: 0 })}
              fmtLine={(v) => fmtCur(v, "USD", { decimals: 0 })}
              height={200}
              zh={zh}
            />
          </div>
        ) : (
          <div className="fin-empty" role="status">
            {pick(zh, "No open-market volume in the trailing window.", "回溯窗口内无公开市场交易量。")}
          </div>
        )}
      </div>

      {/* ── Recent open-market trades (18-month window) ── */}
      <div className="fin-sec">
        <div className="fin-eyebrow">{pick(zh, "Filings", "申报记录")}</div>
        <div
          className="fin-sec-h fin-rail fin-rule fin-insider-tradehdr"
          style={{ "--rail": "var(--brand)" } as React.CSSProperties}
        >
          {pick(zh, "Insider trades — last 18 months", "内部交易 — 近18个月")}
          {mostRecentDate && (
            <span className="fin-insider-lasttrade">
              {pick(zh, `Most recent: ${fmtDate(mostRecentDate, { short: false })}`, `最近一笔: ${fmtDate(mostRecentDate, { short: false })}`)}
            </span>
          )}
        </div>
        {isQuiet ? (
          <div className="fin-empty" role="status">
            {lastTradeAgeD != null
              ? pick(zh,
                  `No open-market insider trades in the last ${Math.round(lastTradeAgeD / 30)} months.`,
                  `过去 ${Math.round(lastTradeAgeD / 30)} 个月内无公开市场内部人交易。`
                )
              : pick(zh, "No insider trades on record.", "暂无内部交易记录。")
            }
          </div>
        ) : (
          <div className="fin-table-scroll">
            <table className="fin-table fin-stats-tbl fin-insider-tbl">
              <thead>
                <tr>
                  <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">{pick(zh, "Date", "日期")}</th>
                  <th className="fin-cell fin-cell-head" scope="col">{pick(zh, "Insider", "内部人")}</th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">{pick(zh, "Type", "类型")}</th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">{pick(zh, "Shares", "股数")}</th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">{pick(zh, "Price", "价格")}</th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">{pick(zh, "Value", "金额")}</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t, i) => {
                  // Age-aware date dimming: trades older than a year read fainter.
                  const ageMs = Date.now() - new Date(t.date).getTime();
                  const stale = ageMs > 365 * 86_400_000;
                  return (
                    <tr key={i} className="fin-row">
                      <th className={"fin-cell fin-cell-sticky" + (stale ? " fin-insider-stale" : "")} scope="row">{fmtDate(t.date, { short: false })}</th>
                      <td className="fin-cell">
                        <span className="fin-insider-role">{t.title}</span>
                      </td>
                      <td className="fin-cell fin-cell-num">
                        <span className={`fin-insider-pill ${t.side === "buy" ? "up" : "down"}`}>
                          {t.side === "buy" ? pick(zh, "Buy", "买入") : pick(zh, "Sell", "卖出")}
                        </span>
                      </td>
                      <td className="fin-cell fin-cell-num fin-insider-mono">{fmtNum(t.shares, { decimals: 0 })}</td>
                      <td className="fin-cell fin-cell-num fin-insider-mono">{t.price != null ? fmtCur(t.price, "USD") : "—"}</td>
                      <td className="fin-cell fin-cell-num fin-insider-mono">{t.usd != null ? fmtCur(t.usd, "USD") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="fin-asof">
          {pick(zh, `${asofQLabel} SEC filing data (as of ${d.asof}) · filing dates (public). Open-market P/S only.`, `${asofQLabel} SEC 申报数据（截至 ${d.asof}）· 申报公开日期。仅公开市场买卖 (P/S)。`)}
        </div>
      </div>

      <Disclaimer zh={zh} />
    </div>
  );
}

export default memo(InsiderPage);
