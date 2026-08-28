"use client";
/**
 * OverviewPage — the TradingView "Financials · Overview" tab (BUILD-SPEC §3.4
 * FE2a, spec/overview-page.md). Sections top→bottom:
 *   Key facts · About (Show more) · Ownership donut + Capital structure ·
 *   Valuation (P/S line, A/Q) · Growth & Profitability (Performance combo +
 *   Revenue→profit waterfall, A/Q) · Revenue breakdown (2 donuts, R6 empty) ·
 *   Estimates (Revenue + Earnings dot charts) · Dividends strip · Financial
 *   health (Debt bars + Position bars).
 *
 * Major section headers carry a `›` that jumps to a sibling financials tab via
 * onNavigate(page). Everything is null-guarded — a section renders `—` / a
 * `.fin-empty` instead of crashing when its slice of `fund` is absent.
 */
import { useState } from "react";
import { useLang } from "../../lib/i18n";
import {
  pick,
  fmtNum,
  fmtPct,
  fmtDate,
  nextDateCountdown,
  currencySymbol,
  statementCurrencyCode,
  statementCurrencyLabel,
} from "../../lib/finFormat";
import type { Fund, IncomeBlock, StatementPeriodSet } from "../../lib/fund";
// Every income series on this page is normalized ONCE (lib/finStatementMath): raw for a
// discrete-quarter market, differenced for a cumulative year-to-date one. Reading `set.income`
// straight made the Valuation, Performance and Waterfall cards disagree with the Statements tab —
// and, on the same A/Q toggle, with each other.
import {
  cumulativeQuarterNote,
  incomeViewFamilyDisclosure,
  incomeViewFamilyMode,
  incomeChartValues,
  incomeViewTopLineLabel,
  incomeView,
  isIndustrialIncomeView,
  resolveStatementBasis,
  statementBasisAvailable,
  statementCadenceLabel,
} from "../../lib/finStatementMath";
import {
  incomeBridgeSteps,
  netMarginPct,
  priceToSalesSeries,
  type IncomeBridgeKey,
} from "../../lib/finSeries";
import type { FinPage } from "./MegaPane";
import {
  Donut,
  CapitalStructure,
  LineSeries,
  ComboChart,
  Waterfall,
  Dumbbell,
  Bars,
  type Series,
  type DonutSlice,
  type WaterfallStep,
  type DumbbellPoint,
} from "./FinCharts";

export interface OverviewPageProps {
  sym: string;
  fund: Fund | null;
  name?: string | null;
  onNavigate: (page: FinPage) => void;
}

type AQ = "annual" | "quarterly";

/**
 * Section header with optional uppercase eyebrow above and a `›` jump to a
 * sibling tab. v7 framework transfer: rail + hairline rule on every header.
 * Rail stays `var(--brand)` (analytical) across this page — no section on the
 * Overview is a directional call or a caution block, and a static `--warn` rail
 * on "Financial health" would read as a verdict on every company alike.
 */
function SecH({
  title,
  eyebrow,
  cap,
  page,
  onNavigate,
  rail = "var(--brand)",
}: {
  title: string;
  eyebrow?: string;
  cap?: string;
  page?: FinPage;
  onNavigate?: (p: FinPage) => void;
  rail?: string;
}) {
  const clickable = !!page && !!onNavigate;
  return (
    <>
      {eyebrow && <div className="fin-eyebrow">{eyebrow}</div>}
      <div
        className={"fin-sec-h fin-rail fin-rule" + (clickable ? " link" : "")}
        style={{ "--rail": rail } as React.CSSProperties}
        onClick={clickable ? () => onNavigate!(page!) : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
      >
        <span>{title}</span>
        {clickable && <span className="chev">›</span>}
      </div>
      {cap && <div className="fin-sec-cap">{cap}</div>}
    </>
  );
}

export default function OverviewPage({ sym, fund, name, onNavigate }: OverviewPageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const nextEarningsDate = fund?.earnings?.next_date ?? null;
  const nextEarningsCountdown = nextDateCountdown(nextEarningsDate);
  const [showMore, setShowMore] = useState(false);
  const [requestedValAQ, setValAQ] = useState<AQ>("annual");
  const [requestedPerfAQ, setPerfAQ] = useState<AQ>("annual");
  const [requestedWfAQ, setWfAQ] = useState<AQ>("annual");
  const [requestedHealthAQ, setHealthAQ] = useState<AQ>("annual");

  // quote_currency = price/mktcap side; stmt_currency = statement/estimate side.
  // For many HK names these differ (0700.HK: quote HKD vs stmt CNY) — NEVER mix
  // the two in a ratio or a combined chart, and label each section by its own.
  const quoteCur = fund?.quote_currency || "USD";
  const stmtCur = statementCurrencyCode(fund?.stmt_currency);
  const statementCurrencyUnknown = stmtCur == null;
  const crossCur = stmtCur != null && quoteCur !== stmtCur;
  const comparisonSuppressed = statementCurrencyUnknown || crossCur;
  // statement-derived values (waterfall, revenue combo, health bars, segments)
  const stmtSuffix = stmtCur ? ` ${stmtCur}` : "";
  const fmtV = (v: number) => fmtNum(v) + stmtSuffix;

  if (!fund) {
    return (
      <div className="fin-empty fin-empty-lg" role="status">
        <div className="fin-empty-title">{pick(zh, "No fundamentals yet", "暂无基本面数据")}</div>
        <div className="fin-empty-why">
          {pick(
            zh,
            `Fundamental data for ${sym} hasn't been collected yet. Coverage is extended nightly by dollar volume.`,
            `${sym} 的基本面数据尚未采集。覆盖范围每夜按成交额扩展。`,
          )}
        </div>
      </div>
    );
  }

  const p = fund.profile;
  const s = fund.stats;
  const r = fund.ratios;
  const ann = fund.statements?.annual;
  const qtr = fund.statements?.quarterly;
  const annualAvailable = statementBasisAvailable(ann);
  const interimAvailable = statementBasisAvailable(qtr);
  const valAQ = resolveStatementBasis(requestedValAQ, annualAvailable, interimAvailable);
  const perfAQ = resolveStatementBasis(requestedPerfAQ, annualAvailable, interimAvailable);
  const wfAQ = resolveStatementBasis(requestedWfAQ, annualAvailable, interimAvailable);
  const healthAQ = resolveStatementBasis(requestedHealthAQ, annualAvailable, interimAvailable);

  // ── provenance helpers (every data section dates itself — v7 honest chrome) ──
  // Everything here comes from the single fund snapshot, so `fund.asof` is the
  // one truthful date; the leading basis names WHICH slice the row covers.
  const asofD = fund.asof ? fmtDate(fund.asof) : "";
  const asofLine = (en: string, cn: string) => pick(zh, `${en} · as of ${asofD}`, `${cn} · 截至 ${asofD}`);
  const aqEn = (a: AQ, set?: StatementPeriodSet | null) => statementCadenceLabel(set, a, false);
  const aqZh = (a: AQ, set?: StatementPeriodSet | null) => statementCadenceLabel(set, a, true);
  /** "Annual statements 2020–2025 · as of …" — the period span is real data. */
  const stmtAsof = (a: AQ, set?: StatementPeriodSet | null) => {
    const ps = set?.periods ?? [];
    const rg = ps.length > 1 ? ` ${ps[0]}–${ps[ps.length - 1]}` : ps.length === 1 ? ` ${ps[0]}` : "";
    return asofLine(`${aqEn(a, set)} statements${rg}`, `${aqZh(a, set)}报表${rg}`);
  };

  // ── Key stats (headline KPI strip) ──
  // `s` carries the qualifier that used to live in parentheses inside the label
  // so the tile label stays legible at KPI width. Two qualifiers were also WRONG
  // before and are corrected here: dividends.yield_ttm is trailing, not
  // "indicated"; basic EPS is the latest ANNUAL figure, not TTM.
  const facts: { k: string; v: string; s?: string; ext?: string; txt?: boolean }[] = [
    {
      k: pick(zh, "Market cap", "市值"),
      v: s?.mktcap != null ? fmtNum(s.mktcap) : "—",
      s: s?.mktcap != null ? quoteCur : undefined,
    },
    {
      k: pick(zh, "Dividend yield", "股息率"),
      v: fund.dividends?.yield_ttm != null ? fmtPct(fund.dividends.yield_ttm) : "—",
      s: "TTM",
    },
    {
      k: pick(zh, "P/E ratio", "市盈率"),
      v: r?.current?.pe_ttm != null ? fmtNum(r.current.pe_ttm) : "—",
      s: "TTM",
    },
    {
      k: pick(zh, "Basic EPS", "基本每股收益"),
      v: latestEps(ann) != null ? fmtNum(latestEps(ann)!) : "—",
      s: pick(zh, "Latest FY", "最近财年"),
    },
    { k: pick(zh, "Founded", "成立"), v: p?.founded || "—" },
    {
      k: pick(zh, "Employees", "员工人数"),
      v: p?.employees == null ? "—" : Math.round(p.employees).toLocaleString("en-US"),
    },
    { k: pick(zh, "Sector", "板块"), v: p?.sector || "—", txt: true },
    {
      k: pick(zh, "Website", "网站"),
      v: p?.website ? domainOf(p.website) : "—",
      ext: p?.website || undefined,
      txt: true,
    },
  ];

  // ── About ──
  const desc = p?.description || "";
  const CLAMP = 320;
  const clamped = desc.length > CLAMP && !showMore ? desc.slice(0, CLAMP).replace(/\s+\S*$/, "") + "…" : desc;

  // ── Ownership ──
  const totalShares = s?.shares_out ?? null;
  const freePct = fund.ownership?.free_float_pct ?? null;
  const heldPct = fund.ownership?.closely_held_pct ?? null;
  const ownSlices: DonutSlice[] =
    totalShares != null && (freePct != null || heldPct != null)
      ? [
          {
            label: pick(zh, "Free float shares", "自由流通股"),
            value: freePct != null ? totalShares * freePct : 0,
            color: "var(--warn)",
          },
          {
            label: pick(zh, "Closely held shares", "内部持股"),
            value: heldPct != null ? totalShares * heldPct : Math.max(0, totalShares - (freePct ?? 0) * totalShares),
            color: "var(--muted)",
          },
        ].filter((x) => x.value > 0)
      : [];

  // ── Valuation: P/S per period ──
  // P/S = mktcap (quote_currency) / revenue (stmt_currency). When the two
  // currencies differ we have no FX rate in the contract, so the ratio is
  // meaningless — suppress the series and show a cross-currency empty state.
  const valSet = valAQ === "annual" ? ann : qtr;
  const valView = incomeView(sym, valSet, valAQ);
  const psLabels = valView.periods;
  const valFamilyMode = incomeViewFamilyMode(valView);
  const valIsIndustrial = isIndustrialIncomeView(valView);
  const psSeries: Series[] = [
    {
      name: pick(zh, "P/S (at current mkt cap)", "市销率（按当前市值）"),
      // Normalized revenue: a market cap over a year-to-date total is a P/S no quarter ever had.
      values: priceToSalesSeries(valView.income.revenue, s?.mktcap ?? null, psLabels),
      color: "var(--brand)",
    },
  ];
  // Disclosure for a differenced quarterly statement — null unless this issuer's market actually
  // files cumulative year-to-date interims, so it can never describe a US filer's numbers.
  const valCumNote = cumulativeQuarterNote(valView, zh);

  // ── Performance combo (revenue bars + net income bars + net margin line) ──
  const perfSet = perfAQ === "annual" ? ann : qtr;
  const perfView = incomeView(sym, perfSet, perfAQ);
  const perfLabels = perfView.periods;
  const perfInc = incomeChartValues(perfView);
  const perfBars: Series[] = [
    { name: incomeViewTopLineLabel(perfView, zh), values: perfInc.revenue, color: "var(--brand)" },
    { name: pick(zh, "Net income", "净利润"), values: perfInc.net_income, color: "var(--up)" },
  ];
  const perfLine: Series = {
    name: pick(zh, "Net margin %", "净利率 %"),
    // Same normalized pair as the bars above it (lib/finSeries) — never a differenced net income
    // over a cumulative revenue.
    values: netMarginPct(perfInc.revenue, perfInc.net_income),
    color: "var(--warn)",
  };

  // ── Revenue → profit conversion waterfall (latest period) ──
  const wfSet = wfAQ === "annual" ? ann : qtr;
  const wfView = incomeView(sym, wfSet, wfAQ);
  const wfFamilyMode = incomeViewFamilyMode(wfView);
  const wfIdx = lastFiniteIdx(wfView.income.revenue);
  const wfSteps: WaterfallStep[] =
    wfIdx == null || !isIndustrialIncomeView(wfView)
      ? []
      : buildWaterfall(wfView.income, wfIdx, zh);
  const perfFamilyNote = incomeViewFamilyDisclosure(perfView, zh);

  // ── Revenue breakdown (R6: empty unless fund.segments present) ──
  const seg = fund.segments;
  const segPeriods = seg?.by_source?.periods ?? seg?.by_country?.periods ?? [];
  const segLast = segPeriods[segPeriods.length - 1];

  // ── Estimates: revenue + earnings actual-vs-estimate ──
  const revDots: DumbbellPoint[] = (fund.earnings?.fy ?? []).map((f) => ({
    label: f.period,
    actual: f.rev_a,
    estimate: f.rev_e,
  }));
  const epsDots: DumbbellPoint[] = (fund.earnings?.fy ?? []).map((f) => ({
    label: f.period,
    actual: f.eps_a,
    estimate: f.eps_e,
  }));

  // ── Financial health: debt/fcf/cash bars + position bars ──
  const hSet = healthAQ === "annual" ? ann : qtr;
  const hView = incomeView(sym, hSet, healthAQ);
  const hFamilyMode = incomeViewFamilyMode(hView);
  const hIsIndustrial = isIndustrialIncomeView(hView);
  const hLabels = hView.periods;
  // Balance-sheet categories are CATEGORICAL, not directional — never --up/--down
  // (those flip under the east red-up theme and carry price-direction meaning).
  const debtBars: Series[] = [
    { name: pick(zh, "Debt", "债务"), values: hSet?.balance?.debt ?? [], color: "var(--warn)" },
    ...(hIsIndustrial
      ? [{ name: pick(zh, "Free cash flow", "自由现金流"), values: hSet?.cashflow?.fcf ?? [], color: "var(--code-fn)" }]
      : []),
    { name: pick(zh, "Cash & equivalents", "现金及等价物"), values: hSet?.balance?.cash ?? [], color: "var(--brand)" },
  ];
  const posIdx = lastFiniteIdx(hSet?.balance?.assets_st);
  const posBars: Series[] =
    posIdx == null
      ? []
      : [
          {
            name: pick(zh, "Assets", "资产"),
            values: [hSet!.balance.assets_st[posIdx], hSet!.balance.assets_lt[posIdx]],
            color: "var(--brand)",
          },
          {
            name: pick(zh, "Liabilities", "负债"),
            values: [hSet!.balance.liab_st[posIdx], hSet!.balance.liab_lt[posIdx]],
            color: "var(--warn)",
          },
        ];
  const posLabels = [pick(zh, "Short term", "短期"), pick(zh, "Long term", "长期")];

  // bilingual cross-currency explanation (P/S + capital-structure suppression)
  const currencyComparisonMsg = statementCurrencyUnknown
    ? pick(
        zh,
        "Statement currency is unavailable; this comparison is suppressed to avoid mixing price values with financials in an unverified unit.",
        "报表货币不可用；为避免将股价数据与计价单位未经验证的财务数据混用，此项已隐藏。",
      )
    : pick(
        zh,
        `Price is in ${quoteCur} but financials are reported in ${stmtCur}; this comparison is suppressed to avoid mixing currencies.`,
        `股价以 ${quoteCur} 计价，而财报以 ${stmtCur} 列报；为避免货币混用，此项已隐藏。`,
      );

  return (
    <div className="fin-ov">
      {/* ── KEY FACTS (headline KPI strip) ── */}
      <section className="fin-sec">
        <SecH eyebrow={pick(zh, "FUNDAMENTALS", "基本面")} title={pick(zh, "Key facts", "关键数据")} />
        <div className="fin-kpis">
          {facts.map((f, i) => (
            <div className="fin-kpi" key={i}>
              <span className="k">{f.k}</span>
              {f.ext ? (
                <a
                  className={"v fin-fact-link" + (f.txt ? " txt" : " num")}
                  href={f.ext}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {f.v} ↗
                </a>
              ) : (
                <span className={"v" + (f.txt ? " txt" : " num")}>{f.v}</span>
              )}
              {f.s && <span className="s">{f.s}</span>}
            </div>
          ))}
        </div>
        {fund.asof && (
          <div className="fin-asof">{asofLine("Company profile & market data", "公司资料与市场数据")}</div>
        )}
      </section>

      {/* ── ABOUT ── */}
      {desc && (
        <section className="fin-sec">
          <SecH title={pick(zh, "About", "公司简介")} />
          <p className="fin-about">
            {clamped}
            {desc.length > CLAMP && (
              <button className="fin-showmore" onClick={() => setShowMore((v) => !v)}>
                {showMore ? pick(zh, "Show less", "收起") : pick(zh, "Show more", "展开")}
              </button>
            )}
          </p>
        </section>
      )}

      {/* ── OWNERSHIP + CAPITAL STRUCTURE ── */}
      <section className="fin-sec">
        <div className="fin-grid2">
          <div className="fin-card">
            <div className="fin-card-h">{pick(zh, "Ownership", "股权结构")}</div>
            {ownSlices.length > 0 ? (
              <Donut
                slices={ownSlices}
                centerValue={fmtNum(totalShares)}
                centerLabel={pick(zh, "Shares out", "总股本")}
                fmtV={fmtNum}
                zh={zh}
              />
            ) : (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">{pick(zh, "No ownership data", "暂无股权数据")}</div>
                <div className="fin-empty-why">
                  {pick(
                    zh,
                    `The fundamentals feed carries no free-float or closely-held split for ${sym}.`,
                    `基本面数据源未提供 ${sym} 的自由流通股或内部持股拆分。`,
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="fin-card">
            <div className="fin-card-h">{pick(zh, "Capital structure", "资本结构")}</div>
            {comparisonSuppressed ? (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">{pick(zh, "Comparison suppressed", "该对比已隐藏")}</div>
                <div className="fin-empty-why">{currencyComparisonMsg}</div>
              </div>
            ) : (
              <CapitalStructure
                marketCap={s?.mktcap ?? null}
                debt={latestFinite(ann?.balance?.debt) ?? latestFinite(qtr?.balance?.debt)}
                cash={latestFinite(ann?.balance?.cash) ?? latestFinite(qtr?.balance?.cash)}
                fmtV={fmtNum}
                zh={zh}
              />
            )}
          </div>
        </div>
        {fund.asof && (
          <div className="fin-asof">{asofLine("Ownership & balance sheet", "股权与资产负债表")}</div>
        )}
      </section>

      {/* ── VALUATION ── */}
      <section className="fin-sec">
        <SecH
          title={pick(zh, "Valuation", "估值")}
          cap={pick(zh, "Fundamental metrics to determine fair value of the stock", "用于判断股票公允价值的基本面指标")}
          page="statistics"
          onNavigate={onNavigate}
        />
        <div className="fin-card">
          <div className="fin-card-h">
            {pick(zh, "Valuation ratios", "估值比率")} <AQToggle v={valAQ} onChange={setValAQ} zh={zh} annualAvailable={annualAvailable} interimSet={qtr} interimAvailable={interimAvailable} />
          </div>
          {comparisonSuppressed || !valIsIndustrial ? (
            <div className="fin-empty fin-empty-lg" role="status">
              <div className="fin-empty-title">{pick(zh, "Comparison suppressed", "该对比已隐藏")}</div>
              <div className="fin-empty-why">
                {comparisonSuppressed
                  ? currencyComparisonMsg
                  : valFamilyMode === "mixed"
                    ? pick(
                        zh,
                        "P/S is hidden because this history crosses industrial and financial-services statement formats, so its top-line values are not one comparable sales denominator.",
                        "该历史区间跨越工业企业与金融服务报表格式，各期顶线口径不构成可比的销售额分母，因此不显示市销率。",
                      )
                    : pick(
                        zh,
                        "P/S is not shown for this financial-statement family because operating income is not an industrial sales denominator.",
                        "该金融报表类型不显示市销率，因为营业收入并非工业企业销售额口径。",
                      )}
              </div>
            </div>
          ) : (
            <>
              <LineSeries labels={psLabels} series={psSeries} fmtY={(v) => fmtNum(v)} markers zh={zh} height={190} />
              <div className="fin-chart-note">
                {pick(
                  zh,
                  "Uses today's market cap against each period's revenue — not a historical valuation (past market caps aren't available).",
                  "以当前市值除以各期营收计算，并非历史估值（无历史市值数据）。",
                )}
              </div>
              {valCumNote && <div className="fin-chart-note">{valCumNote}</div>}
            </>
          )}
        </div>
        {fund.asof && !comparisonSuppressed && valIsIndustrial && <div className="fin-asof">{stmtAsof(valAQ, valSet)}</div>}
      </section>

      {/* ── GROWTH & PROFITABILITY ── */}
      <section className="fin-sec">
        <SecH
          eyebrow={pick(zh, "PERFORMANCE", "经营表现")}
          title={pick(zh, "Growth and Profitability", "增长与盈利能力")}
          cap={pick(zh, "Company's recent performance and margins", "公司近期业绩与利润率")}
          page="statements"
          onNavigate={onNavigate}
        />
        <div className="fin-grid2">
          <div className="fin-card">
            <div className="fin-card-h">
              {pick(zh, "Performance", "业绩表现")} <AQToggle v={perfAQ} onChange={setPerfAQ} zh={zh} annualAvailable={annualAvailable} interimSet={qtr} interimAvailable={interimAvailable} />
            </div>
            <ComboChart
              labels={perfLabels}
              bars={perfBars}
              line={perfLine}
              fmtBar={fmtNum}
              fmtLine={(v) => fmtPct(v, { alreadyPct: true })}
              zh={zh}
              height={200}
            />
          </div>
          <div className="fin-card">
            <div className="fin-card-h">
              {pick(zh, "Revenue to profit conversion", "营收到利润转换")}{" "}
              <AQToggle v={wfAQ} onChange={setWfAQ} zh={zh} annualAvailable={annualAvailable} interimSet={qtr} interimAvailable={interimAvailable} />
            </div>
            {wfSteps.length > 0 ? (
              <Waterfall steps={wfSteps} fmtY={fmtNum} zh={zh} height={210} />
            ) : (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">
                  {wfFamilyMode === "industrial"
                    ? pick(zh, "No income statement", "暂无利润表")
                    : wfFamilyMode === "mixed"
                      ? pick(zh, "Industrial bridge not comparable", "工业利润桥不可比")
                      : pick(zh, "Industrial bridge not applicable", "工业利润桥不适用")}
                </div>
                <div className="fin-empty-why">
                  {wfFamilyMode === "industrial"
                    ? pick(
                        zh,
                        `No ${aqEn(wfAQ, wfSet).toLowerCase()} period on record carries revenue for ${sym}, so the conversion bridge has nothing to walk down.`,
                        `${sym} 没有任何带营收的${aqZh(wfAQ, wfSet)}期间记录，因此无法绘制利润转换瀑布图。`,
                      )
                    : wfFamilyMode === "mixed"
                      ? pick(
                          zh,
                          "This history crosses industrial and financial-services statement formats, so one industrial revenue-to-profit waterfall would combine non-comparable line items.",
                          "该历史区间跨越工业企业与金融服务报表格式，单一工业企业营收到利润瀑布图会混合不可比项目。",
                        )
                      : pick(
                          zh,
                          "Banks, insurers and financial-services issuers use a different income-statement structure, so an industrial revenue-to-profit waterfall would be misleading.",
                          "银行、保险及金融服务企业采用不同的利润表结构，因此工业企业的营收到利润瀑布图会造成误导。",
                        )}
                </div>
              </div>
            )}
          </div>
        </div>
        {perfFamilyNote && <div className="fin-chart-note">{perfFamilyNote}</div>}
        {fund.asof && <div className="fin-asof">{stmtAsof(perfAQ, perfSet)}</div>}
      </section>

      {/* ── REVENUE BREAKDOWN (R6 empty state) ── */}
      <section className="fin-sec">
        <SecH
          eyebrow={pick(zh, "SEGMENTS", "分部")}
          title={pick(zh, "Revenue breakdown", "收入构成")}
          cap={pick(zh, "Revenue streams and regions a business earns money from", "企业收入来源与地区分布")}
          page="revenue"
          onNavigate={onNavigate}
        />
        {seg && (seg.by_source || seg.by_country) ? (
          <div className="fin-grid2">
            {seg.by_source && (
              <div className="fin-card">
                <div className="fin-card-h">{pick(zh, "By source/business", "按业务")}</div>
                <Donut slices={segToSlices(seg.by_source)} fmtV={fmtV} zh={zh} />
              </div>
            )}
            {seg.by_country && (
              <div className="fin-card">
                <div className="fin-card-h">{pick(zh, "By country", "按地区")}</div>
                <Donut slices={segToSlices(seg.by_country)} fmtV={fmtV} zh={zh} />
              </div>
            )}
          </div>
        ) : (
          <div className="fin-empty fin-empty-lg" role="status">
            <div className="fin-empty-title">{pick(zh, "No segment breakdown", "暂无分部数据")}</div>
            <div className="fin-empty-why">
              {pick(
                zh,
                `The source filing for ${sym} publishes no by-business or by-region revenue split.`,
                `${sym} 的数据源未披露分业务或分地区的收入拆分。`,
              )}
            </div>
          </div>
        )}
        {fund.asof && segLast && (
          <div className="fin-asof">{asofLine(`Segment disclosure ${segLast}`, `分部披露 ${segLast}`)}</div>
        )}
      </section>

      {/* ── ESTIMATES ── */}
      <section className="fin-sec">
        <SecH
          eyebrow={pick(zh, "CONSENSUS", "一致预期")}
          title={pick(zh, "Estimates", "预测")}
          cap={pick(zh, "Revenue and Earnings forecasts and estimates accuracy", "营收与盈利预测及预测准确度")}
          page="earnings"
          onNavigate={onNavigate}
        />
        <div className="fin-grid2">
          <div className="fin-card">
            <div className="fin-card-h">{pick(zh, "Revenue", "营收")}</div>
            {revDots.some((d) => d.actual != null || d.estimate != null) ? (
              <Dumbbell points={revDots} fmtY={fmtNum} zh={zh} height={200} />
            ) : (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">{pick(zh, "No revenue estimates", "暂无营收预测")}</div>
                <div className="fin-empty-why">
                  {pick(
                    zh,
                    `No fiscal year on record carries a revenue actual or a consensus estimate for ${sym}.`,
                    `${sym} 无任何财年记录带有营收实际值或一致预期。`,
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="fin-card">
            <div className="fin-card-h">
              {pick(zh, "Earnings", "盈利")}
              {nextEarningsCountdown != null && (
                <span className="fin-tag fin-next-lbl" style={{ "--c": "var(--brand-2)" } as React.CSSProperties}>
                  {pick(zh, "Next:", "下次:")} {fmtDate(nextEarningsDate)}
                </span>
              )}
            </div>
            {epsDots.some((d) => d.actual != null || d.estimate != null) ? (
              <Dumbbell points={epsDots} fmtY={(v) => fmtNum(v, { decimals: 2 })} zh={zh} height={200} />
            ) : (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">{pick(zh, "No earnings estimates", "暂无盈利预测")}</div>
                <div className="fin-empty-why">
                  {pick(
                    zh,
                    `No fiscal year on record carries an EPS actual or a consensus estimate for ${sym}.`,
                    `${sym} 无任何财年记录带有每股盈利实际值或一致预期。`,
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {fund.asof && <div className="fin-asof">{asofLine("Consensus estimates", "一致预期数据")}</div>}
      </section>

      {/* ── DIVIDENDS ── */}
      <section className="fin-sec">
        <SecH
          eyebrow={pick(zh, "CAPITAL RETURNS", "资本回报")}
          title={pick(zh, "Dividends", "股息")}
          cap={pick(zh, "Dividend yield, history and sustainability", "股息率、历史及可持续性")}
          page="dividends"
          onNavigate={onNavigate}
        />
        {fund.dividends?.never_paid || (fund.dividends?.events ?? []).length === 0 ? (
          <div className="fin-card fin-div-empty">
            <svg className="fin-div-glyph" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M5 5l14 14" />
            </svg>
            <div>
              <div className="fin-div-empty-t">{pick(zh, "No dividends", "无股息")}</div>
              {/* The two cases are NOT the same fact: never_paid is an issuer
                  statement; an empty event list only means nothing is on file. */}
              <div className="fin-div-empty-s">
                {fund.dividends?.never_paid
                  ? pick(
                      zh,
                      `${sym} has never paid dividends and has no current plans to do so.`,
                      `${sym} 从未派发股息，目前也无相关计划。`,
                    )
                  : pick(
                      zh,
                      `No dividend event is on file for ${sym} in this dataset.`,
                      `本数据集中没有 ${sym} 的任何派息记录。`,
                    )}
              </div>
            </div>
          </div>
        ) : (
          <div className="fin-grid3">
            <div className="fin-fact">
              <span className="k">{pick(zh, "Yield (TTM)", "股息率（TTM）")}</span>
              <span className="v">{fund.dividends.yield_ttm != null ? fmtPct(fund.dividends.yield_ttm) : "—"}</span>
            </div>
            <div className="fin-fact">
              <span className="k">{pick(zh, "Payout ratio", "派息率")}</span>
              <span className="v">
                {fund.dividends.payout_ratio != null ? fmtPct(fund.dividends.payout_ratio) : "—"}
              </span>
            </div>
            <div className="fin-fact">
              <span className="k">{pick(zh, "Last ex-date", "最近除息日")}</span>
              <span className="v">{fmtDate(fund.dividends.events[fund.dividends.events.length - 1]?.ex)}</span>
            </div>
          </div>
        )}
        {fund.asof && <div className="fin-asof">{asofLine("Dividend history", "股息历史")}</div>}
      </section>

      {/* ── FINANCIAL HEALTH ── */}
      <section className="fin-sec">
        <SecH
          eyebrow={pick(zh, "BALANCE SHEET", "资产负债")}
          title={pick(zh, "Financial health", "财务健康")}
          cap={pick(zh, "Financial position and solvency of the company", "公司财务状况与偿债能力")}
          page="statistics"
          onNavigate={onNavigate}
        />
        <div className="fin-grid2">
          <div className="fin-card">
            <div className="fin-card-h">
              {pick(zh, "Debt level and coverage", "债务水平与覆盖")}{" "}
              <AQToggle v={healthAQ} onChange={setHealthAQ} zh={zh} annualAvailable={annualAvailable} interimSet={qtr} interimAvailable={interimAvailable} />
            </div>
            <Bars labels={hLabels} series={debtBars} fmtY={fmtNum} zh={zh} height={200} />
            {!hIsIndustrial && (
              <div className="fin-chart-note">
                {hFamilyMode === "mixed"
                  ? pick(
                      zh,
                      "Free cash flow is omitted because this history crosses industrial and financial-services statement formats, so CFO less capex is not one comparable measure.",
                      "该历史区间跨越工业企业与金融服务报表格式，经营现金流减资本开支不构成单一可比指标，因此不显示自由现金流。",
                    )
                  : pick(
                      zh,
                      "Free cash flow is omitted for financial-services statement formats because operating cash flow and capital expenditure do not form an industrially comparable FCF measure.",
                      "金融服务报表中的经营现金流与资本开支不构成与工业企业可比的自由现金流指标，因此不显示。",
                    )}
              </div>
            )}
          </div>
          <div className="fin-card">
            <div className="fin-card-h">{pick(zh, "Financial position analysis", "财务状况分析")}</div>
            {posBars.length > 0 ? (
              <Bars labels={posLabels} series={posBars} fmtY={fmtNum} zh={zh} height={200} />
            ) : (
              <div className="fin-empty fin-empty-lg" role="status">
                <div className="fin-empty-title">{pick(zh, "No balance sheet", "暂无资产负债表")}</div>
                <div className="fin-empty-why">
                  {pick(
                    zh,
                    `No ${aqEn(healthAQ, hSet).toLowerCase()} period on record splits current from non-current assets for ${sym}.`,
                    `${sym} 没有任何${aqZh(healthAQ, hSet)}期间记录区分流动与非流动资产。`,
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {fund.asof && <div className="fin-asof">{stmtAsof(healthAQ, hSet)}</div>}
      </section>

      <div className="fin-ov-cur">
        {pick(zh, "Statement values", "报表数据")} · {statementCurrencyLabel(stmtCur, zh)}
        {comparisonSuppressed && (
          <>
            {" · "}
            {pick(zh, "Price values in", "股价数据计价")} {currencySymbol(quoteCur) || quoteCur} · {quoteCur}
          </>
        )}
      </div>
    </div>
  );
}

/* ── A/Q toggle ── */
function AQToggle({
  v,
  onChange,
  zh,
  annualAvailable,
  interimSet,
  interimAvailable,
}: {
  v: AQ;
  onChange: (a: AQ) => void;
  zh: boolean;
  annualAvailable: boolean;
  interimSet?: StatementPeriodSet | null;
  interimAvailable: boolean;
}) {
  return (
    <span className="fin-toggle fin-aq">
      <button className={v === "annual" ? "on" : ""} onClick={() => onChange("annual")} disabled={!annualAvailable}>
        {pick(zh, "Annual", "年度")}
      </button>
      <button className={v === "quarterly" ? "on" : ""} onClick={() => onChange("quarterly")} disabled={!interimAvailable}>
        {statementCadenceLabel(interimSet, "quarterly", zh)}
      </button>
    </span>
  );
}

/* ── helpers ── */
function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function latestFinite(arr?: (number | null)[]): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && isFinite(arr[i] as number)) return arr[i];
  return null;
}

function lastFiniteIdx(arr?: (number | null)[]): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && isFinite(arr[i] as number)) return i;
  return null;
}

function latestEps(set?: StatementPeriodSet | null): number | null {
  return latestFinite(set?.income?.eps_basic);
}

/**
 * The bridge from revenue to net income for ONE period of an ALREADY-NORMALIZED income block.
 *
 * Takes `incomeView(...).income`, never a `StatementPeriodSet`: with no set in scope the bridge
 * cannot reach a raw `set.income` array, so a cumulative year-to-date column can never be walked
 * down as though it were the quarter. (P/S moved out entirely — lib/finSeries.priceToSalesSeries.)
 *
 * Each bridge movement is the exact delta between reported subtotals. That is more robust than
 * trusting a vendor expense field whose scope varies, and it guarantees the bridge closes at
 * every subtotal. Deltas remain signed: tax benefits and net operating credits rise rather than
 * being forced into a fall with `Math.abs`.
 */
function buildWaterfall(inc: IncomeBlock, i: number, zh: boolean): WaterfallStep[] {
  const labels: Record<IncomeBridgeKey, string> = {
    revenue: pick(zh, "Revenue", "营收"),
    to_gross_profit: pick(zh, "COGS & gross adjustments", "成本及毛利调整"),
    gross_profit: pick(zh, "Gross profit", "毛利"),
    to_operating_income: pick(zh, "Operating expenses & other", "营业费用及其他"),
    operating_income: pick(zh, "Op income", "营业利润"),
    to_pretax_income: pick(zh, "Non-op & other", "营业外及其他"),
    pretax_income: pick(zh, "Pretax income", "税前利润"),
    to_net_income: pick(zh, "Taxes & other", "税项及其他"),
    net_income: pick(zh, "Net income", "净利润"),
  };
  return incomeBridgeSteps(inc, i).map((step) => ({
    label: labels[step.key],
    value: step.value,
    total: step.total,
  }));
}

function segToSlices(seg: { periods: string[]; series: { name: string; values: (number | null)[] }[] }): DonutSlice[] {
  const last = seg.periods.length - 1;
  return seg.series
    .map((s) => ({ label: s.name, value: (s.values?.[last] ?? 0) as number }))
    .filter((s) => s.value != null && isFinite(s.value) && s.value > 0);
}
