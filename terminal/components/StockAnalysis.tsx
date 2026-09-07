"use client";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { nextDateCountdown, pick as pickI18n, fmtPct } from "@/lib/finFormat";
import type { Fund, Opts, Bar } from "@/lib/fund";
import { buildKeyStatRows, formatCompactStat } from "@/lib/keyStats";
// Income series are normalized ONCE, in the shared statement math — never read off `set.income`
// (see lib/finStatementMath's header); the margin line rides the same normalized pair.
import {
  incomeChartValues,
  incomeViewTopLineLabel,
  incomeView,
  resolveStatementBasis,
  statementBasisAvailable,
  statementCadenceLabel,
} from "@/lib/finStatementMath";
import { netMarginPct } from "@/lib/finSeries";
import { computeRatings } from "@/lib/techRating";
import { realizedVolCone } from "@/lib/realizedVol";
import { Dumbbell, ComboChart, LineSeries, type Series } from "@/components/fin/FinCharts";
import { ArcGauge } from "@/components/ui/ArcGauge";
// Single source of truth for the analyst rating reading + verdict word + arc
// mapping — shared with ForecastPage so the rail gauge and the Analyst/Technicals
// panes never disagree on reading, verdict, or where buy/hold/sell begin.
import { analystReading, ratingVerdict, readingToArc } from "@/components/fin/ForecastPage";
// From the import-free leaf, not MegaPane: StockAnalysis is eagerly loaded by the chart
// shell, so sourcing anything here from MegaPane risks re-introducing the value edge that
// pulls the whole fundamentals graph into first paint (components/fin/finPages.ts).
import type { FinPage } from "@/components/fin/finPages";
import EventEdgePop from "@/components/fin/EventEdgePop";
// R3.2 positioning block: the ONE regime colour/label convention (lib/mscGlance + the
// desk's gexStrings), staleness via the shared weekday counter. The parent parses the
// payload (root-match guard needs the authoritative active symbol) and passes the row.
import { REGIME_COLORS, type GlanceRow } from "@/lib/mscGlance";
// HK-O1: the marker stream's meaning lives in `blocked`/`basis`, not in `type` — one shared
// reader so this list, the rail card and the chart glyphs cannot label the same event three ways.
import { isBlockedSignal, isStructureStop, sliceSignalBasis } from "@/lib/signalVerdict";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { sessionsOldEt } from "@/lib/optionsLevels";
import {
  MACRO_DURATION_ZH,
  MACRO_INFLATION_ZH,
  MACRO_REGIME_ZH,
  macroChipLabel,
  regimeLabel as plainRegime,
  trustTierLabel,
} from "@/lib/plainLabels";

/* ── value formatting ───────────────────────────────────────────────── */
const fnum = (n: number | null | undefined, d = 2) =>
  n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fpct = (n: number | null | undefined, d = 1, sign = true) =>
  n == null || !isFinite(n) ? "—" : `${sign && n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const money = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
};
const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
/* buy zone / band: the engine emits either a [lo,hi] tuple or a {low,high} object — render both */
const bandStr = (bz: any): string => {
  if (Array.isArray(bz)) return bz.length >= 2 && bz[0] != null ? (bz[0] === bz[1] ? fnum(bz[0]) : `${fnum(bz[0])}–${fnum(bz[1])}`) : "—";
  if (bz && bz.low != null && bz.high != null) return bz.low === bz.high ? fnum(bz.low) : `${fnum(bz.low)}–${fnum(bz.high)}`;
  return "—";
};

/* ── tiny visual primitives ─────────────────────────────────────────── */
function Ring({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r = (size - 7) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg className="sa-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-3)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="sa-ring-n" fill="var(--text)">{Math.round(score)}</text>
    </svg>
  );
}
/* diverging bar centered at 0, value in [-clamp, +clamp] */
function Diverge({ v, clamp = 2 }: { v: number | null | undefined; clamp?: number }) {
  const x = v == null || !isFinite(v) ? 0 : Math.max(-clamp, Math.min(clamp, v));
  const w = (Math.abs(x) / clamp) * 50;
  const pos = x >= 0;
  return (
    <span className="sa-div">
      <i className="sa-div-mid" />
      <i className="sa-div-fill" style={{ width: `${w}%`, left: pos ? "50%" : `${50 - w}%`, background: pos ? "var(--up)" : "var(--down)" }} />
    </span>
  );
}
/* 0..100 fill bar */
function Meter({ pct, color = "var(--brand)" }: { pct: number | null | undefined; color?: string }) {
  const w = pct == null || !isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  return <span className="sa-meter"><i style={{ width: `${w}%`, background: color }} /></span>;
}
function Spark({ data, color = "var(--brand-2)" }: { data: (number | null)[]; color?: string }) {
  const pts = (data || []).filter((x): x is number => x != null && isFinite(x));
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const W = 100, H = 26;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / span) * (H - 4) - 2}`).join(" ");
  return (
    <svg className="sa-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Section({ title, sub, children, accent }: { title: string; sub?: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="sa-sec">
      <div className="sa-sec-h" style={accent ? { borderLeftColor: accent } : undefined}>
        <span>{title}</span>{sub && <small>{sub}</small>}
      </div>
      {children}
    </div>
  );
}
function Stat({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "up" | "down" | "" }) {
  return <div className="sa-stat"><span className="k">{k}</span><span className={`v num ${tone || ""}`}>{v}</span></div>;
}

/* ── TV-parity rail widgets (BUILD-SPEC §3.5.1) ─────────────────────────
   All null-guarded; the parent hides a section when its widget returns null.
   Labels are bilingual via the `pick` closure passed down from the main
   component (identical behavior to the rest of the file). "More …" buttons
   call onOpenPane(page) → MegaPane. */

type Pick = (en?: string | null, cn?: string | null) => string;
const MB = formatCompactStat;

/** Cross-market fundamentals plus trading activity; all rows remain null-honest. */
function KeyStats({ fund, bars, pick }: { fund: Fund | null; bars: Bar[]; pick: Pick }) {
  const rows = buildKeyStatRows(fund, bars, pick);
  if (!rows.length) return null;
  return (
    <Section title={pick("Key stats", "关键数据")}>
      <div className="sa-kstats">
        {rows.map((row) => (
          <div key={row.id} className="sa-kstat">
            <span className="k">{row.label}</span>
            <span className="v num">{row.value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Earnings mini: last-4Q + next EPS dumbbell, days-to-earnings badge, More info. */
function EarningsMini({ fund, pick, onOpen }: { fund: Fund | null; pick: Pick; onOpen?: () => void }) {
  const q = fund?.earnings?.q ?? [];
  if (!q.length) return null;
  const tail = q.slice(-4);
  const points = tail.map((r) => ({ label: periodShort(r.period), actual: r.eps_a, estimate: r.eps_e }));
  // forward estimate-only column
  if (fund?.earnings?.next_eps_est != null)
    points.push({ label: periodShort(fund.earnings.next_period), actual: null, estimate: fund.earnings.next_eps_est });
  if (points.every((p) => p.actual == null && p.estimate == null)) return null;
  const nDays = nextDateCountdown(fund?.earnings?.next_date);
  return (
    <Section title={pick("Earnings", "盈利")} sub={nDays != null ? `${nDays}${pick("d", "天")}` : undefined}>
      <Dumbbell points={points} vw={300} vh={150} zh={undefined} noWindow />
      {onOpen && <button className="sa-more-btn" onClick={onOpen}>{pick("More info", "更多")} ›</button>}
    </Section>
  );
}

/** Dividends line: never-paid empty copy, else yield + next ex-date. */
function DividendsMini({ fund, pick }: { fund: Fund | null; pick: Pick }) {
  const div = fund?.dividends;
  if (!div) return null;
  if (div.never_paid) {
    return (
      <Section title={pick("Dividends", "股息")}>
        <p className="sa-desc" style={{ margin: 0 }}>{pick(`${fund!.ticker} has never paid dividends and has no current plans to do so.`, `${fund!.ticker} 从未派发股息，目前也无相关计划。`)}</p>
      </Section>
    );
  }
  const nextEx = div.events?.length ? div.events[div.events.length - 1].ex : null;
  return (
    <Section title={pick("Dividends", "股息")}>
      <div className="sa-grid2">
        {/* yield_ttm is a 0..1 FRACTION in the fund contract (sibling of payout_ratio/gross_margin);
            render via the shared fmtPct default (×100) so AAPL's 0.0035 shows 0.35%, not 35%. */}
        {div.yield_ttm != null && <Stat k={pick("Yield (TTM)", "股息率(TTM)")} v={fmtPct(div.yield_ttm, { decimals: 2, sign: false })} />}
        {div.payout_ratio != null && <Stat k={pick("Payout", "派息率")} v={fpct(div.payout_ratio * 100, 0, false)} />}
        {nextEx && <Stat k={pick("Latest ex-date", "最近除息日")} v={nextEx} />}
      </div>
    </Section>
  );
}

const STMT_KEYS = ["income", "balance", "cashflow"] as const;
type StmtKey = typeof STMT_KEYS[number];

/** Financials mini: ComboChart driven by a statement dropdown + A/Q toggle. */
function FinancialsMini({ fund, pick, zh, onOpen }: { fund: Fund | null; pick: Pick; zh: boolean; onOpen?: () => void }) {
  const [stmt, setStmt] = useState<StmtKey>("income");
  const [annual, setAnnual] = useState(true);
  const annualAvailable = statementBasisAvailable(fund?.statements?.annual);
  const interimAvailable = statementBasisAvailable(fund?.statements?.quarterly);
  // Keep a valid basis when the selected symbol has annual statements only (or when navigation
  // replaces an interim-capable symbol while this mounted rail still has the interim toggle set).
  const effectiveAnnual = resolveStatementBasis(
    annual ? "annual" : "quarterly",
    annualAvailable,
    interimAvailable,
  ) === "annual";
  const ps = effectiveAnnual ? fund?.statements?.annual : fund?.statements?.quarterly;
  if (!ps || !ps.periods?.length) return null;
  const timeframe = effectiveAnnual ? "annual" : "quarterly";
  const view = incomeView(fund?.ticker, ps, timeframe);
  const labels = (stmt === "income" ? view.periods : ps.periods).map((p) => periodShort(p));
  let barsSeries: Series[] = [];
  let line: Series = { name: "", values: [] };
  if (stmt === "income") {
    // ONE normalization, the same one the Statements tab prints (lib/finStatementMath): raw for a
    // discrete-quarter market, differenced for a cumulative year-to-date one. Reading `ps.income`
    // here plotted a CN/HK name's year-to-date totals in this rail while the Statements tab showed
    // the discrete quarter — same quarter, two numbers, two tabs. `fund.ticker` is the symbol this
    // widget has (same source lib/finStatements.revenueHistory uses); the timeframe follows the A/Q
    // toggle, so the annual set is never differenced.
    const { revenue: rev, net_income: ni } = incomeChartValues(view);
    barsSeries = [
      { name: incomeViewTopLineLabel(view, zh), values: rev, color: "var(--brand-2)" },
      { name: pick("Income", "净利润"), values: ni, color: "var(--signal)" },
    ];
    // The margin rides the SAME normalized pair (lib/finSeries) — never a differenced net income
    // over a cumulative revenue, which is a margin no period ever had.
    line = { name: pick("Margin %", "净利率%"), values: netMarginPct(rev, ni), color: "var(--warn)" };
  } else if (stmt === "balance") {
    barsSeries = [
      { name: pick("Total assets", "总资产"), values: ps.balance.assets, color: "#9d86ff" },
      { name: pick("Total liabilities", "总负债"), values: ps.balance.liabilities, color: "#e8a33d" },
    ];
    line = { name: pick("Liab / assets %", "负债率%"), values: ps.balance.assets.map((av, i) => (av && ps.balance.liabilities[i] != null ? (ps.balance.liabilities[i]! / av) * 100 : null)), color: "#4aa8ff" };
  } else {
    // cash flow: three lines (operating / investing / financing) — no bars
    return (
      <Section title={pick("Financials", "财务")}>
        <FinMiniControls
          stmt={stmt}
          setStmt={setStmt}
          annual={effectiveAnnual}
          setAnnual={setAnnual}
          annualAvailable={annualAvailable}
          interimLabel={statementCadenceLabel(fund?.statements?.quarterly, "quarterly", zh)}
          interimAvailable={interimAvailable}
          pick={pick}
        />
        <LineSeries labels={labels} markers refLine={0}
          series={[
            { name: pick("Operating", "经营"), values: ps.cashflow.cfo, color: "#f06bd0" },
            { name: pick("Investing", "投资"), values: ps.cashflow.cfi, color: "#4aa8ff" },
            { name: pick("Financing", "筹资"), values: ps.cashflow.cff, color: "var(--up)" },
          ]}
          fmtY={MB} vw={300} vh={160} />
        {onOpen && <button className="sa-more-btn" onClick={onOpen}>{pick("More financials", "更多财务")} ›</button>}
      </Section>
    );
  }
  return (
    <Section title={pick("Financials", "财务")}>
      <FinMiniControls
        stmt={stmt}
        setStmt={setStmt}
        annual={effectiveAnnual}
        setAnnual={setAnnual}
        annualAvailable={annualAvailable}
        interimLabel={statementCadenceLabel(fund?.statements?.quarterly, "quarterly", zh)}
        interimAvailable={interimAvailable}
        pick={pick}
      />
      <ComboChart labels={labels} bars={barsSeries} line={line} fmtBar={MB} vw={300} vh={170} />
      {onOpen && <button className="sa-more-btn" onClick={onOpen}>{pick("More financials", "更多财务")} ›</button>}
    </Section>
  );
}

function FinMiniControls({ stmt, setStmt, annual, setAnnual, annualAvailable, interimLabel, interimAvailable, pick }: { stmt: StmtKey; setStmt: (s: StmtKey) => void; annual: boolean; setAnnual: (a: boolean) => void; annualAvailable: boolean; interimLabel: string; interimAvailable: boolean; pick: Pick }) {
  const label: Record<StmtKey, string> = {
    income: pick("Income statement", "利润表"),
    balance: pick("Balance sheet", "资产负债表"),
    cashflow: pick("Cash flow", "现金流量表"),
  };
  return (
    <div className="sa-fin-ctl">
      <select className="sa-fin-sel" value={stmt} onChange={(e) => setStmt(e.target.value as StmtKey)}>
        {STMT_KEYS.map((k) => <option key={k} value={k}>{label[k]}</option>)}
      </select>
      <div className="sa-fin-aq">
        <button className={annual ? "on" : ""} onClick={() => setAnnual(true)} disabled={!annualAvailable}>{pick("Annual", "年度")}</button>
        <button
          className={!annual ? "on" : ""}
          onClick={() => setAnnual(false)}
          disabled={!interimAvailable}
        >
          {interimLabel}
        </button>
      </div>
    </div>
  );
}

const PERF_PERIODS: [string, number][] = [["1W", 5], ["1M", 21], ["3M", 63], ["6M", 126], ["YTD", -1], ["1Y", 252]];

/** Performance grid — 6 tiles computed client-side from daily bars. */
function PerfGrid({ bars, pick }: { bars: Bar[]; pick: Pick }) {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1].c;
  const ytdStart = (() => {
    const y = new Date().getUTCFullYear();
    for (let i = bars.length - 1; i >= 0; i--) { if (String(bars[i].time).slice(0, 4) < String(y)) return bars[i].c; }
    return bars[0].c;
  })();
  const tiles = PERF_PERIODS.map(([lbl, n]) => {
    const base = n < 0 ? ytdStart : (bars.length > n ? bars[bars.length - 1 - n].c : null);
    const ret = base != null && base !== 0 && isFinite(last) ? ((last - base) / base) * 100 : null;
    return { lbl, ret };
  }).filter((t) => t.ret != null);
  if (!tiles.length) return null;
  return (
    <Section title={pick("Performance", "表现")}>
      <div className="sa-perf-grid">
        {tiles.map((t) => { const up = (t.ret ?? 0) >= 0; return (
          <div key={t.lbl} className={`sa-perf-tile ${up ? "up" : "down"}`}>
            <span className="pv num">{fpct(t.ret, 2)}</span>
            <span className="pk">{t.lbl}</span>
          </div>
        ); })}
      </div>
    </Section>
  );
}

/** Technicals gauge — compact ArcGauge from techRating on daily bars. */
function TechGauge({ bars, pick, onOpen }: { bars: Bar[]; pick: Pick; onOpen?: () => void }) {
  const ratings = useMemo(() => (bars.length >= 30 ? computeRatings(bars) : null), [bars]);
  if (!ratings) return null;
  const overall = ratings.summary[2];
  const arc = readingToArc(overall.score);
  return (
    <Section title={pick("Technicals", "技术评级")}>
      <div className="sa-gauge fin-arc-wrap">
        <ArcGauge value={arc.value} state={arc.state} size={150} sublabel={pick(...verdictBi(overall.verdict))} />
        <div className="fin-gauge-counts">
          <span className="down">{pick("Sell", "卖")} {overall.sell}</span>
          <span className="mut">{pick("Neutral", "中性")} {overall.neutral}</span>
          <span className="up">{pick("Buy", "买")} {overall.buy}</span>
        </div>
      </div>
      {onOpen && <button className="sa-more-btn" onClick={onOpen}>{pick("More technicals", "更多技术面")} ›</button>}
    </Section>
  );
}

/** Analyst gauge — fund.analyst dist → gauge + target/upside. CN empty-state. */
function AnalystGauge({ fund, spot, pick, onOpen, hasIntelAnalyst }: { fund: Fund | null; spot: number | null; pick: Pick; onOpen?: () => void; hasIntelAnalyst?: boolean }) {
  const an = fund?.analyst;
  if (!an) {
    // CN names carry null fund.analyst but often DO carry an intel analyst block (44 analysts etc.).
    // Only show the "no consensus" empty state when fund exists, its analyst is null, AND there is no
    // pre-existing intel analyst section — otherwise the two surfaces would contradict each other.
    if (fund && fund.analyst === null && !hasIntelAnalyst) return (
      <Section title={pick("Analyst rating", "分析师评级")}>
        <p className="sa-desc" style={{ margin: 0 }}>{pick("No analyst consensus for this market.", "该市场暂无分析师一致预期。")}</p>
      </Section>
    );
    return null;
  }
  const d = an.dist;
  // Shared reading + verdict word (identical logic to the ForecastPage gauge).
  const score = analystReading(d);
  const target = an.target?.mean ?? null;
  const upside = target != null && spot != null && spot !== 0 ? ((target - spot) / spot) * 100 : null;
  if (score == null && target == null) return null;
  // Never empty: falls back to the zone word when rating_label is null.
  const verdict = ratingVerdict(an.rating_label, score, false) || undefined;
  return (
    <Section title={pick("Analyst rating", "分析师评级")}>
      {score != null && (() => {
        const arc = readingToArc(score);
        return (
          <div className="sa-gauge fin-arc-wrap">
            <ArcGauge value={arc.value} state={arc.state} size={150} sublabel={verdict} />
            <div className="fin-gauge-counts">
              <span className="down">{pick("Sell", "卖")} {d.sell + d.strongSell}</span>
              <span className="mut">{pick("Neutral", "中性")} {d.hold}</span>
              <span className="up">{pick("Buy", "买")} {d.buy + d.strongBuy}</span>
            </div>
          </div>
        );
      })()}
      {target != null && (
        <div className="sa-grid2">
          <Stat k={pick("1yr price target", "1年目标价")} v={fnum(target)} />
          {upside != null && <Stat k={pick("Upside", "上行空间")} v={fpct(upside, 2)} tone={upside >= 0 ? "up" : "down"} />}
        </div>
      )}
      {onOpen && <button className="sa-more-btn" onClick={onOpen}>{pick("See forecast", "查看预测")} ›</button>}
    </Section>
  );
}

/** IV minis — term structure + smile sparklines from opts; RV-cone fallback. */
function IvMini({ opts, bars, pick }: { opts: Opts | null; bars: Bar[]; pick: Pick }) {
  // hooks must run unconditionally — compute the RV cone up front even when opts is present.
  const cone = useMemo(() => (bars.length >= 30 ? realizedVolCone(bars) : []), [bars]);
  if (opts && opts.term?.length) {
    const termLabels = opts.term.map((t) => t.label);
    const termVals = opts.term.map((t) => t.iv * 100);
    const smile = opts.smile;
    const smileOk = smile && smile.strikes?.length > 1;

    // staleness: opts.json is rebuilt nightly; >1 trading-day old is stale.
    // opts.asof is a DATE-ONLY string (e.g. "2026-07-03"). new Date("2026-07-03") parses
    // as UTC midnight, so a rolling 24h delta would fire any US market hour the next day
    // (diff 30-37h > 24h), falsely labelling perfectly-fresh EOD data as STALE.
    // Fix: compare calendar dates at local noon to avoid the UTC-midnight boundary,
    // and tolerate the weekend gap (Friday data is fresh through Monday, diff≤3).
    const optsAsof = opts.asof ?? null;
    const optsStale = optsAsof
      ? (() => {
          const m = optsAsof.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) return false;
          const asofNoon = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
          const todayNoon = new Date(); todayNoon.setHours(12, 0, 0, 0);
          const diffDays = Math.round((todayNoon.getTime() - asofNoon.getTime()) / 86_400_000);
          if (diffDays <= 1) return false;
          // Weekend tolerance: Friday EOD data is fresh on Saturday (diff=1, already covered),
          // Sunday (diff=2) and Monday (diff=3).
          const dow = todayNoon.getDay(); // 0=Sun, 1=Mon
          if (dow === 0 && diffDays <= 2) return false;
          if (dow === 1 && diffDays <= 3) return false;
          return true;
        })()
      : false;

    return (
      <Section title={pick("Implied volatility", "隐含波动率")} sub={smile?.dte != null ? `${smile.dte}${pick("d smile", "天微笑")}` : undefined}>
        <div className="sa-iv-mini">
          <div className="sa-iv-lbl">{pick("ATM term structure", "ATM期限结构")}</div>
          <LineSeries labels={termLabels} series={[{ name: "IV", values: termVals, color: "var(--brand-2)" }]} markers noLegend fmtY={(v) => v.toFixed(0) + "%"} vw={300} vh={110} />
        </div>
        {smileOk && (
          <div className="sa-iv-mini">
            <div className="sa-iv-lbl">{pick(`Vol curve (${smile.dte}d)`, `波动率曲线 (${smile.dte}天)`)}</div>
            <LineSeries labels={smile.strikes.map((s) => fnum(s, s < 10 ? 1 : 0))} series={[{ name: "IV", values: smile.iv.map((v) => v * 100), color: "var(--brand-2)" }]} noLegend fmtY={(v) => v.toFixed(0) + "%"} vw={300} vh={110} />
          </div>
        )}
        {optsAsof && (
          <div className="sa-iv-asof" style={{ fontSize: "var(--font-num, 11px)", color: "var(--text-2)", marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
            <span>{pick(`as of ${optsAsof}`, `数据截至 ${optsAsof}`)}</span>
            {optsStale && (
              <span style={{ color: "var(--warn, #e6a817)", fontWeight: 600, fontSize: "0.9em" }}>
                {pick("STALE", "数据过期")}
              </span>
            )}
          </div>
        )}
      </Section>
    );
  }
  // non-optionable fallback: realized-vol cone from daily bars (computed above, hooks-safe)
  const usable = cone.filter((c) => c.current != null);
  if (!usable.length) return null;
  return (
    <Section title={pick("Realized volatility", "已实现波动率")} sub={pick("cone", "锥形")}>
      <div className="sa-iv-mini">
        <LineSeries labels={usable.map((c) => c.window + "d")}
          series={[
            { name: pick("Current", "当前"), values: usable.map((c) => (c.current ?? 0) * 100), color: "var(--brand-2)" },
            { name: pick("Median", "中位"), values: usable.map((c) => (c.median ?? 0) * 100), color: "var(--text-2)" },
          ]}
          dotted={[1]} markers fmtY={(v) => v.toFixed(0) + "%"} vw={300} vh={120} />
      </div>
    </Section>
  );
}

/** Profile block — website / employees / sector / industry + description clamp. */
function ProfileBlock({ fund, pick }: { fund: Fund | null; pick: Pick }) {
  const p = fund?.profile;
  if (!p || (!p.website && !p.employees && !p.sector && !p.industry && !p.description)) return null;
  return (
    <Section title={pick("Profile", "公司概况")}>
      <div className="sa-grid2">
        {p.website && <Stat k={pick("Website", "网站")} v={<a href={/^https?:/.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" style={{ color: "var(--brand-2)" }}>{p.website.replace(/^https?:\/\//, "")}</a>} />}
        {p.employees != null && <Stat k={pick("Employees", "员工")} v={MB(p.employees)} />}
        {p.sector && <Stat k={pick("Sector", "板块")} v={p.sector} />}
        {p.industry && <Stat k={pick("Industry", "行业")} v={p.industry} />}
      </div>
      {p.description && <p className="sa-desc sa-desc-clamp">{p.description}</p>}
    </Section>
  );
}

/* fiscal-quarter/year short label: "Q3 2026"→"Q3 '26", "2025"→"'25", passthrough otherwise */
function periodShort(period?: string | null): string {
  if (!period) return "";
  const raw = period.trim();
  let m = raw.match(/^Q([1-4])\s+(\d{4})$/);
  if (m) return `Q${m[1]} '${m[2].slice(2)}`;
  m = raw.match(/^(\d{4})-?Q([1-4])$/);
  if (m) return `Q${m[2]} '${m[1].slice(2)}`;
  if (/^\d{4}$/.test(raw)) return `'${raw.slice(2)}`;
  return raw;
}
/* techRating Verdict → [en, zh] for the gauge word */
function verdictBi(v: string): [string, string] {
  switch (v) {
    case "Strong buy": return ["Strong buy", "强烈买入"];
    case "Buy": return ["Buy", "买入"];
    case "Sell": return ["Sell", "卖出"];
    case "Strong sell": return ["Strong sell", "强烈卖出"];
    default: return ["Neutral", "中性"];
  }
}

/* ── staleness helper (shared by D1 in chip + OracleDash) ──────────── */
function intelStaleDays(intelAsof?: string | null): number {
  if (!intelAsof) return 0;
  const m = intelAsof.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const asofNoon = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  const todayNoon = new Date(); todayNoon.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((todayNoon.getTime() - asofNoon.getTime()) / 86_400_000));
}

/* ── main component ─────────────────────────────────────────────────── */
export default function StockAnalysis({
  intel, row, slice, deep = false, onExpand, fund = null, opts = null, bars = [], glance = null, onOpenPane, onOpenSignals, beforeIv,
}: {
  intel: any; row?: any; slice?: any; deep?: boolean; onExpand?: () => void;
  fund?: Fund | null; opts?: Opts | null; bars?: Bar[]; glance?: GlanceRow | null; onOpenPane?: (page: FinPage) => void; onOpenSignals?: () => void;
  beforeIv?: React.ReactNode;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  // trust-tier popup: anchored with position:fixed to the badge so it can't be clipped by the
  // scrolling detail rail / modal body (an absolute popup gets cut off by their overflow:auto)
  const [trustPop, setTrustPop] = useState<{ x: number; y: number } | null>(null);
  const showTrust = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setTrustPop({ x: Math.round(r.left), y: Math.round(r.bottom + 6) }); };
  // clickable trust badge → EventEdgePop (R15): hover keeps the compact tooltip, click opens the
  // anchored event-edge dashboard. We stash the badge's viewport rect for the popover to anchor to.
  const [edgePop, setEdgePop] = useState<DOMRect | null>(null);
  // Refactored per §3.5.1: the bilingual selector now comes from the shared lib/finFormat `pick`
  // (signature (zh, en, cn)). This local closure captures `zh` so every existing call site —
  // pick(en, cn) — keeps identical behavior.
  const pick = (en?: string | null, cn?: string | null) => pickI18n(zh, en, cn);
  // The research desk historically emitted an `intel.analysis` block (rich decision/entry/factors).
  // The live pipeline now ships the compact `intel.cards` schema instead. Adapt the compact schema
  // into the fields this component already renders so no information is thrown away — and, crucially,
  // present conviction + timing as clearly-labelled SUPPORTING dimensions rather than a THIRD verdict
  // competing with the Golden Oracle (which owns the trade call in the rail card above).
  const a = useMemo(() => {
    if (intel?.analysis) return intel.analysis;
    const c = intel?.cards;
    if (!c) return null;
    const cv = c.conviction || {};
    const aj = c.ai_judgment || {};   // plain-language timing read: "Hold off — timing against you"
    return {
      _fromCards: true,
      conviction: { score: cv.score, band: cv.band, drivers: cv.drivers, cautions: cv.cautions },
      // ai_judgment answers "act now?" — surface it as a labelled timing headline, not a verdict
      entry: (aj.verdict || aj.gloss) ? { status: "watch", headline: aj.verdict, action: aj.gloss } : null,
    } as any;
  }, [intel]);

  const dec = a?.decision, conv = a?.conviction, entry = a?.entry, fac = a?.factors,
    tech = a?.tech, val = a?.valuation, fin = a?.financials, prof = a?.profile,
    sm = a?.smart_money, ae = a?.analyst, macro = a?.macro, fl = a?.flows;
  // R3.2: dealer positioning comes from the OPTIONS flow plane (gexstate:{ROOT}), not intel —
  // fresh intel payloads no longer carry analysis.gex (the bridge drops it; only stale legacy
  // files still have one), so the old intel-fed gamma block could only ever show stale data.
  const gexT = useMemo(() => makeGexT(lang), [lang]);
  // Does the pre-existing intel analyst section render? (mirrors its gate below.) When it does, the
  // new AnalystGauge must NOT show its "no consensus" empty state (CN dual-surface contradiction).
  const hasIntelAnalyst = !!(ae && (ae.next_date || ae.surprises || ae.target != null || ae.rating || ae.buy != null));

  const score = conv?.score ?? dec?.score ?? null;
  // the compact-schema hero has no research verdict of its own — it's a supporting confidence read
  const supporting = !!a?._fromCards && !dec;

  // ── Live tech rating (D1/D2): computed from bars (always fresher than intel.analysis) ──
  const techRatings = useMemo(() => (bars.length >= 30 ? computeRatings(bars) : null), [bars]);
  const techOverall = techRatings?.summary[2].score ?? null;   // [-1, 1]

  // ── D1: Freshness discount ──
  const staleDays = intelStaleDays(intel?.asof);
  const freshnessW = Math.min(0.5, Math.max(0, (staleDays - 2) / 10));  // 0 when ≤2 days old
  const rawConvScore = conv?.score ?? dec?.score ?? null;
  // Blended score: (1-w)*desk + w*tech. HOUSE LAW: tech may only DE-ESCALATE — never raise the
  // displayed score above the raw desk reading. Take min(rawConvScore, blend) to enforce this.
  const _blend = (rawConvScore != null && techOverall != null && freshnessW > 0)
    ? Math.round((1 - freshnessW) * rawConvScore + freshnessW * ((techOverall + 1) / 2) * 100)
    : rawConvScore;
  // One-directional: tech can only pull score down, never up.
  const displayedScore: number | null = (_blend == null || rawConvScore == null)
    ? _blend
    : Math.min(rawConvScore, _blend);

  // ── D2: Disagreement haircut ──
  // deskLean: +1 = bullish read, -1 = bearish read, 0 = neutral/unclear
  const deskLean: number = (() => {
    const t = (dec?.tone || "").toLowerCase();
    const v = (dec?.verb || "").toUpperCase();
    if (t === "go" || ["BUY", "REBUY", "ADD", "ACCUMULATE"].includes(v)) return 1;
    if (["stop", "sell", "avoid"].includes(t) || ["SELL", "TRIM", "CUT", "AVOID", "REDUCE"].includes(v)) return -1;
    return 0;
  })();
  // Cap at 55 when bull desk + bearish tech (de-escalation only)
  const d2Cap = deskLean === 1 && techOverall != null && techOverall <= -0.3;
  // Color-coherence gate: when the desk is NOT bullish (deskLean<=0), the ring must never enter
  // buy-green (≥66). convScore is a CONVICTION MAGNITUDE, not a direction — blending with a
  // directional tech score can collapse a high-conviction WAIT toward green despite a red verb.
  // Cap at 65 to keep the ring in amber/red territory for non-bullish reads.
  const _afterD2 = (displayedScore != null && d2Cap) ? Math.min(55, displayedScore) : displayedScore;
  const finalScore = (freshnessW > 0 && _afterD2 != null && deskLean <= 0)
    ? Math.min(65, _afterD2)
    : _afterD2;

  // spot for the analyst upside / IV context: prefer the live opts spot, then the last daily bar.
  const spot = opts?.spot ?? (bars.length ? bars[bars.length - 1].c : (typeof row?.last === "number" ? row.last : null));

  // TV-parity market-data widgets (§3.5.1). Rendered in the deep=false rail even when the research
  // desk (intel.analysis) is absent, so a long-tail fund-only name still shows real data. Each
  // widget null-guards and returns null when dataless. Compact in the rail; hidden in `deep` (the
  // mega-pane's mastermind page shows the proprietary deep sections, not these minis).
  const tvWidgets = !deep && (fund || opts || bars.length) ? (
    <>
      <KeyStats fund={fund} bars={bars} pick={pick} />
      <EarningsMini fund={fund} pick={pick} onOpen={onOpenPane && (() => onOpenPane("earnings"))} />
      <DividendsMini fund={fund} pick={pick} />
      <FinancialsMini fund={fund} pick={pick} zh={zh} onOpen={onOpenPane && (() => onOpenPane("statements"))} />
      <PerfGrid bars={bars} pick={pick} />
    </>
  ) : null;
  const tvWidgets2 = !deep && (fund || opts || bars.length) ? (
    <>
      <TechGauge bars={bars} pick={pick} onOpen={onOpenPane && (() => onOpenPane("technicals"))} />
      <AnalystGauge fund={fund} spot={spot} pick={pick} onOpen={onOpenPane && (() => onOpenPane("forecast"))} hasIntelAnalyst={hasIntelAnalyst} />
      <IvMini opts={opts} bars={bars} pick={pick} />
    </>
  ) : null;
  const profileWidget = !deep && fund ? <ProfileBlock fund={fund} pick={pick} /> : null;

  if (!a) {
    return (
      <div className="sa">
        <div className="sa-empty">
          <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7c0 3-2 4-2 6H7c0-2-2-3-2-6a7 7 0 0 1 7-7zM9 21h6" /></svg>
          <b>{pick("Deep analysis coming online", "深度分析即将上线")}</b>
          <span>{pick("This name isn't in the research desk yet — the chart, levels and oracle verdict above are live.", "该标的尚未进入研究台——上方的图表、关键价位与神谕判定仍然有效。")}</span>
        </div>
        {/* fund-only long-tail: still surface TV market-data + technicals below the empty notice */}
        {tvWidgets}
        {tvWidgets2}
        {profileWidget}
      </div>
    );
  }

  const sigs: any[] = slice?.indicator?.signals || [];

  return (
    <div className="sa">
      {pick(dec?.trust_en, dec?.trust_zh) && (
        /* Trust tier = compact badge. Hover keeps the tooltip; CLICK (R15) opens the anchored
           EventEdgePop dashboard (trust prose + structured earnings/edge context chips). */
        <div className="sa-trust" tabIndex={0} role="button"
          title={pick("Click for the event edge", "点击查看事件驱动详情")}
          onMouseEnter={(e) => { if (!edgePop) showTrust(e.currentTarget); }} onMouseLeave={() => setTrustPop(null)}
          onFocus={(e) => { if (!edgePop) showTrust(e.currentTarget); }} onBlur={() => setTrustPop(null)}
          onClick={(e) => { setTrustPop(null); setEdgePop(e.currentTarget.getBoundingClientRect()); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTrustPop(null); setEdgePop((e.currentTarget as HTMLElement).getBoundingClientRect()); } }}>
          <span className="sa-trust-tier">{trustTierLabel(dec?.trust_tier, lang)}</span>
          <svg className="sa-trust-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6h.01" /></svg>
          {trustPop && !edgePop && <div className="sa-trust-pop" role="tooltip" style={{ left: trustPop.x, top: trustPop.y }}>{pick(dec?.trust_en, dec?.trust_zh)}</div>}
        </div>
      )}
      {edgePop && <EventEdgePop anchor={edgePop} intel={intel} zh={zh} onClose={() => setEdgePop(null)} />}
      {/* Drivers / Cautions moved to the Signals dashboard (rail slimming, Lane C). */}

      {/* ── TV market-data widgets: Key stats · Earnings · Dividends · Financials · Performance ── */}
      {tvWidgets}
      {/* ── TV gauges + options minis: Technicals · Analyst · IV ── */}
      {tvWidgets2}

      {/* ── ENTRY TIMING / TIMING QUALITY (answers "act now?") ── */}
      {entry && (entry.status || entry.headline) && (
        <Section title={pick("Timing quality", "时机质量")} sub={entry.grade ? `${pick("grade", "评级")} ${cap(entry.grade)}` : supporting ? pick("act now?", "现在行动？") : undefined}
          accent={entry.status === "open" ? "var(--buy)" : entry.status === "blocked" ? "var(--down)" : "var(--signal)"}>
          <div className="sa-entry-head">
            <span className={`sa-status ${entry.status}`}>{cap(entry.urgency || entry.status)}</span>
            <b>{pick(entry.headline, entry.headline_zh)}</b>
          </div>
          {pick(entry.action, entry.action_zh) && <div className="sa-entry-act">{pick(entry.action, entry.action_zh)}</div>}
          {/* two-column stacked mini-stats: labels sit above values so nothing clips or overlaps at any rail width */}
          <div className="sa-levels">
            <Stat k={pick("Buy zone", "买入区")} v={bandStr(entry.buy_zone)} />
            <Stat k={pick("Chase >", "追入>")} v={fnum(entry.chase_above)} />
            <Stat k={pick("Spot", "现价")} v={fnum(entry.spot)} />
            <Stat k={pick("Stop", "止损")} v={fnum(entry.stop)} tone="down" />
            <Stat k="ATR" v={fpct(entry.atr_pct, 1, false)} />
            <Stat k={pick("Confidence", "置信度")} v={entry.confidence != null ? fnum(entry.confidence, 1) : "—"} />
          </div>
          {entry.horizon && (entry.horizon.d3 != null || entry.horizon.d21 != null || entry.horizon.d63 != null) && (
            <div className="sa-horizon">
              <span className="sa-horizon-lbl">{pick("Forward edge", "前瞻收益")}</span>
              <div className="sa-horizon-boxes">
                {([["3d", entry.horizon.d3], ["21d", entry.horizon.d21], ["63d", entry.horizon.d63]] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="sa-hz"><span className="hk">{k}</span><span className={`hv num ${(v ?? 0) >= 0 ? "up" : "down"}`}>{fpct(v, 2)}</span></div>
                ))}
              </div>
            </div>
          )}
          {entry.cycle && entry.cycle.pct_through != null && (() => {
            const cyc = entry.cycle;
            const pct = Math.max(0, Math.min(100, cyc.pct_through));
            const band = Array.isArray(cyc.dc_band) && cyc.dc_band.length === 2 && cyc.dc_band[1]
              ? { left: Math.max(0, Math.min(100, (cyc.dc_band[0] / (cyc.dc_band[1] * 1.4)) * 100)), width: Math.max(0, Math.min(40, (Math.abs(cyc.dc_band[1] - cyc.dc_band[0]) / (cyc.dc_band[1] * 1.4)) * 100)) }
              : null;
            const phase = cap((cyc.phase || "").replace(/_/g, " "));
            return (
              <div className="sa-cycle">
                <div className="sa-cycle-h">
                  <span>{pick("Cycle position", "周期位置")}</span>
                  <span className="num">{phase}{cyc.dc_day != null ? ` · ${pick("day", "第")} ${fnum(cyc.dc_day, 0)}` : ""}</span>
                </div>
                <div className="sa-cycle-track" title={pick("How far through the current cycle price is. The gold band is the typical entry window; the marker is where price sits now.", "价格在当前周期中的进度。金色区间为典型入场窗口，标记为当前位置。")}>
                  {band && <span className="sa-cycle-band" style={{ left: `${band.left}%`, width: `${band.width}%` }} />}
                  <i className="sa-cycle-fill" style={{ width: `${pct}%` }} />
                  <span className="sa-cycle-now" style={{ left: `${pct}%` }} />
                </div>
                <div className="sa-cycle-legend">
                  <span className="lg band">{pick("Entry window", "入场窗口")}</span>
                  <span className="lg now">{pick("Now", "当前")}</span>
                </div>
              </div>
            );
          })()}
        </Section>
      )}

      {/* ── TECHNICALS ── */}
      {tech && (
        <Section title={pick("Technical read", "技术面")}>
          <div className="sa-chips">
            <span className={`sa-chip ${tech.above200 ? "up" : "down"}`}>{tech.above200 ? "▲" : "▼"} 200-MA</span>
            <span className={`sa-chip ${tech.above50 ? "up" : "down"}`}>{tech.above50 ? "▲" : "▼"} 50-MA</span>
            {tech.golden && <span className="sa-chip up">{pick("Golden cross", "金叉")}</span>}
            {tech.macd_pos != null && <span className={`sa-chip ${tech.macd_pos ? "up" : "down"}`}>MACD {tech.macd_pos ? "+" : "−"}</span>}
            {tech.squeeze_on && <span className="sa-chip warn">{pick("In squeeze", "挤压中")}</span>}
            {tech.adx_trend && <span className="sa-chip">ADX {cap(tech.adx_trend)}</span>}
          </div>
          <div className="sa-grid2">
            <Stat k="RSI(14)" v={fnum(tech.rsi14, 0)} tone={tech.rsi14 != null ? (tech.rsi14 > 70 ? "down" : tech.rsi14 < 30 ? "up" : "") : ""} />
            <Stat k={pick("vs 50-MA", "相对50日")} v={fpct(tech.pct_vs_50dma)} tone={(tech.pct_vs_50dma ?? 0) >= 0 ? "up" : "down"} />
            <Stat k={pick("vs 200-MA", "相对200日")} v={fpct(tech.pct_vs_200dma)} tone={(tech.pct_vs_200dma ?? 0) >= 0 ? "up" : "down"} />
            <Stat k={pick("Off 52w high", "距52周高")} v={fpct(tech.off_52w_high_pct)} tone="down" />
          </div>
          <div className="sa-rets">
            {([["1M", tech.ret_1m], ["3M", tech.ret_3m], ["6M", tech.ret_6m], ["12M", tech.ret_12m]] as [string, number][]).map(([k, v]) => (
              <div key={k} className="sa-ret"><span className="rk">{k}</span><span className={`rv num ${(v ?? 0) >= 0 ? "up" : "down"}`}>{fpct(v, 1)}</span></div>
            ))}
          </div>
        </Section>
      )}

      {/* Factor profile moved to the Signals dashboard (rail slimming, Lane C). */}

      {/* ── VALUATION ── */}
      {val?.ratios?.length && (
        <Section title={pick("Valuation", "估值")} sub={val.forward_pe != null ? `fwd P/E ${fnum(val.forward_pe, 1)}` : undefined}>
          {val.ratios.map((r: any, i: number) => (
            <div key={i} className="sa-val">
              <span className="vk">{r.label}</span>
              <span className="vv num">{fnum(r.v, 1)}<small>{pick("med", "中位")} {fnum(r.med, 1)}</small></span>
              <span className="vmeter" title={`${pick("cheapness pctile", "便宜度分位")} ${fnum(r.cheap, 0)}`}>
                <Meter pct={r.cheap} color={r.cheap != null && r.cheap >= 50 ? "var(--up)" : "var(--down)"} />
              </span>
            </div>
          ))}
          {!deep && onOpenPane && <button className="sa-more-btn" onClick={() => onOpenPane("statistics")}>{pick("More statistics", "更多统计")} ›</button>}
        </Section>
      )}

      {/* ── FINANCIALS ── */}
      {fin && (fin.net_margin != null || fin.multiyear) && (
        <Section title={pick("Financials", "财务")} sub={fin.multiyear?.rev_cagr != null ? `${pick("rev CAGR", "营收复合")} ${fpct(fin.multiyear.rev_cagr, 0)}` : undefined}>
          <div className="sa-grid3">
            <Stat k={pick("Gross", "毛利率")} v={fpct(fin.gross_margin, 0, false)} />
            <Stat k={pick("Net", "净利率")} v={fpct(fin.net_margin, 0, false)} />
            <Stat k={pick("FCF", "自由现金流")} v={fpct(fin.fcf_margin, 0, false)} />
            <Stat k="ROE" v={fpct(fin.roe, 0, false)} tone={(fin.roe ?? 0) >= 15 ? "up" : ""} />
            <Stat k={pick("Rev growth", "营收增长")} v={fpct(fin.rev_growth, 0)} tone={(fin.rev_growth ?? 0) >= 0 ? "up" : "down"} />
            <Stat k={pick("Debt/assets", "负债率")} v={fpct(fin.debt_to_assets, 0, false)} />
          </div>
          {fin.multiyear?.revenue?.length > 1 && (
            <div className="sa-fin-spark">
              <div><span className="sl">{pick("Revenue", "营收")}</span><Spark data={fin.multiyear.revenue} color="var(--brand-2)" /></div>
              {fin.multiyear.eps?.length > 1 && <div><span className="sl">EPS</span><Spark data={fin.multiyear.eps} color="var(--up)" /></div>}
            </div>
          )}
          {(fin.multiyear?.piotroski != null || fin.multiyear?.altman != null) && (
            <div className="sa-quality-row">
              {fin.multiyear?.piotroski != null && <span className="sa-qchip">Piotroski <b>{fnum(fin.multiyear.piotroski, 0)}/9</b></span>}
              {fin.multiyear?.altman != null && <span className="sa-qchip">Altman-Z <b>{fnum(fin.multiyear.altman, 1)}</b></span>}
            </div>
          )}
          {!deep && onOpenPane && <button className="sa-more-btn" onClick={() => onOpenPane("statements")}>{pick("More financials", "更多财务")} ›</button>}
        </Section>
      )}

      {/* ── SMART MONEY ── */}
      {sm?.holders?.length && (
        <Section title={pick("Smart money", "聪明钱")} sub={sm.n_holders != null ? `${sm.n_holders} ${pick("funds", "基金")}${sm.is_vip ? " · VIP" : ""}` : undefined}>
          {sm.holders.slice(0, deep ? 6 : 4).map((h: any, i: number) => (
            <div key={i} className="sa-holder">
              <span className={`sa-act ${h.action}`}>{cap(h.action)}</span>
              <span className="hn">{h.fund}{h.grade && <small className="hg">{h.grade}</small>}</span>
              <span className="hv num">{fpct(h.pct_portfolio, 1, false)}</span>
              <span className="hval num">{money(h.value_usd)}</span>
            </div>
          ))}
          {(sm.n_buying != null || sm.n_selling != null) && (
            <div className="sa-bs"><span className="up">{sm.n_buying ?? 0} {pick("buying", "增持")}</span><span className="down">{sm.n_selling ?? 0} {pick("selling", "减持")}</span></div>
          )}
        </Section>
      )}

      {/* Proprietary "Analysts & earnings" section removed — the rail now has ONE analyst surface,
          the fund-sourced AnalystGauge (with "See forecast ›" → Forecast dash). Lane C. */}

      {/* ── FLOWS & POSITIONING (CN 融资 margin / HK 港股通 southbound) ── */}
      {fl && (fl.own_pct != null || fl.fin_balance_yi != null || fl.lhb_count != null || fl.block_count != null) && (
        <Section title={pick("Flows & positioning", "资金与持仓")}
          sub={fl.kind === "southbound" ? pick("Southbound", "南向资金") : pick("Margin · dragon-tiger", "融资 · 龙虎榜")}>
          <div className="sa-chips">
            {fl.kind === "southbound" ? (
              <>
                {fl.own_pct != null && <span className="sa-chip">{pick("Owns", "持股")} {fpct(fl.own_pct, 1, false)} {pick("of float", "流通")}</span>}
                {fl.chg5_pct != null && <span className={`sa-chip ${fl.chg5_pct >= 0 ? "up" : "down"}`}>{pick("5-day", "5日")} {fpct(fl.chg5_pct, 1)}</span>}
                {fl.hold_b != null && <span className="sa-chip">HK${fnum(fl.hold_b, 1)}B</span>}
                {fl.label && fl.label !== "screen" && <span className="sa-chip">{cap(fl.label)}</span>}
              </>
            ) : (
              <>
                {fl.fin_balance_yi != null && <span className="sa-chip">{pick("Margin bal", "融资余额")} ¥{fnum(fl.fin_balance_yi, 1)}亿</span>}
                {fl.chg_pct != null && <span className={`sa-chip ${fl.chg_pct >= 0 ? "up" : "down"}`}>{fpct(fl.chg_pct, 1)}</span>}
                {fl.pct_mcap != null && <span className="sa-chip">{fpct(fl.pct_mcap, 1, false)} {pick("of mkt cap", "占市值")}</span>}
                {fl.lhb_count != null && <span className={`sa-chip ${(fl.lhb_net_yi ?? 0) >= 0 ? "up" : "down"}`}>{pick("龙虎榜", "龙虎榜")} ×{fl.lhb_count}{fl.lhb_net_yi != null ? ` · ${fl.lhb_net_yi >= 0 ? "+" : ""}¥${fnum(fl.lhb_net_yi, 1)}亿` : ""}</span>}
                {fl.block_count != null && <span className="sa-chip">{pick("Block", "大宗")} ×{fl.block_count}{fl.block_amount_yi != null ? ` · ¥${fnum(fl.block_amount_yi, 1)}亿` : ""}</span>}
              </>
            )}
          </div>
        </Section>
      )}

      {/* ── OPTIONS · DEALER POSITIONING (R3.2) — gexstate:{ROOT} via the flow plane.
          Replaces the old intel-fed block, which was dead twice over: gated behind a
          `deep` prop no call site passes, and reading analysis.gex, which fresh intel
          payloads no longer carry. Renders only when the payload exists (entitled users
          on covered US names); free users' rail is unchanged. Colours follow the desk:
          CW cyan var(--brand-2), PW var(--down), flip violet — never role-inverted. */}
      {glance && (
        <Section
          title={pick("Options · dealer positioning", "期权 · 做市商持仓")}
          sub={glance.asofDate ? `EOD ${glance.asofDate.slice(5)}${sessionsOldEt(glance.asofDate) > 3 ? ` · ${sessionsOldEt(glance.asofDate)}${pick("d old", "日前")}` : ""}` : undefined}
          accent={REGIME_COLORS[glance.regime]}
        >
          {/* regime-dynamics law: the state word never stands alone — stability and
              dist-to-flip ride in the same chip row */}
          <div className="sa-chips">
            <span className="sa-chip" style={{ color: REGIME_COLORS[glance.regime] }}>{plainRegime(gexT, glance.regime, lang)}</span>
            {glance.stabilityPct != null && <span className="sa-chip">{pick("stability", "稳定度")} {fpct(glance.stabilityPct, 0, false)}</span>}
            {glance.distToFlipPct != null && <span className="sa-chip">{pick("to flip", "距翻转")} {fpct(glance.distToFlipPct, 1)}</span>}
          </div>
          <div className="sa-grid2">
            <Stat k={pick("Gamma flip", "伽马翻转")} v={<span style={{ color: "var(--cat-2, var(--ai))" }}>{fnum(glance.gammaFlip)}</span>} />
            <Stat k="Net GEX" v={glance.netGexBn != null ? `${fnum(glance.netGexBn, 2)}B` : "—"} tone={glance.netGexBn != null ? (glance.netGexBn >= 0 ? "up" : "down") : ""} />
            <Stat k={pick("Call wall", "看涨墙")} v={<span style={{ color: "var(--brand-2)" }}>{fnum(glance.callWall)}</span>} />
            <Stat k={pick("Put wall", "看跌墙")} v={<span style={{ color: "var(--down)" }}>{fnum(glance.putWall)}</span>} />
          </div>
          <div className="sa-volhole">
            <span className="vh-meta">{pick("Signed estimate — dealer-sign convention, nightly EOD. Not support/resistance.", "带符号估计 — 做市商方向假设，每日收盘。非支撑/阻力。")}</span>
          </div>
        </Section>
      )}

      {/* ── DEEP: MACRO SENSITIVITY ── */}
      {deep && macro && (macro.tier_en || macro.headline_en) && (
        <Section title={pick("Macro sensitivity", "宏观敏感度")}>
          <div className="sa-chips">
            {macro.tier_en && <span className="sa-chip">{pick("Rate: ", "利率：")}{pick(macro.tier_en, macro.tier_zh)}</span>}
            {macro.duration_en && <span className="sa-chip">{macroChipLabel(macro.duration_en, MACRO_DURATION_ZH, lang)}</span>}
            {macro.regime_en && <span className="sa-chip">{macroChipLabel(macro.regime_en, MACRO_REGIME_ZH, lang)}</span>}
            {macro.inflation_en && <span className="sa-chip">{macroChipLabel(macro.inflation_en, MACRO_INFLATION_ZH, lang)}</span>}
          </div>
          {pick(macro.headline_en, macro.headline_zh) && <div className="sa-macro-head">{pick(macro.headline_en, macro.headline_zh)}</div>}
        </Section>
      )}

      {/* ── DEEP: SIGNAL HISTORY ── */}
      {deep && sigs.length > 0 && (
        <Section title={pick("Signal history", "信号历史")} sub={`${sigs.length} ${pick("events", "次")}`}>
          <div className="sa-siglog">
            {sigs.slice(-12).reverse().map((s: any, i: number) => {
              // HK-O1: `blocked` decides the side, not `type` — a regime-vetoed setup still
              // types BUY/REBUY for back-compat and must not render as a taken entry. A slice
              // SELL is a trailing structure stop and is labelled as one.
              const blocked = isBlockedSignal(s);
              const stop = isStructureStop({ type: s.type, basis: sliceSignalBasis(s) });
              const b = !blocked && (s.type === "BUY" || s.type === "REBUY");
              const label = blocked ? pick("BLOCKED", "已拦截") : stop ? pick("STOP", "止损") : s.type;
              const why = blocked
                ? pick("Entry refused by the regime gate — not an entry", "入场被趋势闸拒绝 — 非入场信号")
                : stop
                  ? pick("Structure stop — the daily close broke the prior swing low, not a momentum exit",
                    "结构止损 — 日线收盘跌破前低，非动量离场")
                  : "";
              return <div key={i} className="sa-sigrow" title={why || undefined}><span className={`sa-sigt ${blocked ? "blocked" : b ? "buy" : "sell"}`}>{label}</span><span className="sd">{s.ts}</span><span className="spx num">{typeof s.price === "number" ? fnum(s.price) : "—"}</span></div>;
            })}
          </div>
        </Section>
      )}

      {/* ── BUSINESS PROFILE ── */}
      {prof && (prof.description || prof.sector) && (
        <Section title={pick("Business profile", "公司概况")}>
          <div className="sa-prof-meta">
            {prof.sector && <span className="sa-chip">{prof.sector}</span>}
            {prof.mktcap_tier && <span className="sa-chip">{pick(prof.mktcap_tier, prof.mktcap_tier_zh)}</span>}
            {prof.mktcap_bn != null && <span className="sa-chip">${fnum(prof.mktcap_bn, 0)}B</span>}
            {prof.archetype && <span className="sa-chip">{pick(prof.archetype, prof.archetype_zh)}</span>}
          </div>
          {pick(prof.description, prof.description_zh) && <p className="sa-desc">{pick(prof.description, prof.description_zh)}</p>}
        </Section>
      )}

      {/* ── PROFILE (fund-sourced: website / employees / sector / industry) ── */}
      {profileWidget}
      {/* Seasonality card injected by the shell (order kept at the tail of the analysis rail). */}
      {beforeIv}
      {/* inline "Open full analysis" button removed — moved to the shell bottom button group (Lane C). */}
    </div>
  );
}
