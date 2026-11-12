/**
 * PRIVATE fixture-ready Terminal TP-2 presentation, server-only until the
 * ORIGINAL tenant entitlement and private R2/Macro service reader are admitted.
 *
 * This component fetches NOTHING, owns no authentication, and has no route.
 * privateViewAuthorized is a defense-in-depth presentation guard: an existing
 * authorized SERVER caller must still enforce access before passing values.
 * Source metrics are observational; no per-print tape, actor, forecast, or
 * trading instruction can be manufactured from these summaries.
 */
import React from "react";
import type {
  Tp2PrivateProjection, Tp2R0Projection,
} from "../../lib/tp2PrivateEvidence";

type Lang = "en" | "zh";
type Props = Readonly<{
  evidence: Tp2PrivateProjection | null;
  r0: Tp2R0Projection | null;
  lang: Lang;
  /** From the ORIGINAL server-side authorization owner; NOT an auth check. */
  privateViewAuthorized: boolean;
}>;

const WORDS = {
  en: {
    title: "Off-Exchange Intelligence",
    subtitle: "Source-aware research · not source authenticated",
    restricted: "Private access required",
    restrictedWhy: "An entitled server read is required before market observations are shown.",
    live: "Provisional tape",
    history: "Historical observations",
    delayed: "Delayed ATS",
    unavailable: "Source not yet available",
    notZero: "Not evidence of zero trading",
    raw: "Provisional any-condition TRF",
    sample: "Sampled lit / TRF prints",
    notComparable: "Not comparable to historical-qualified totals",
    individual: "Individual print",
    cluster: "Same-level cluster",
    total: "Observed day total",
    ruler: "Observed history, not all-time records",
    rank: "Observed sample rank",
    minute: "Minute",
    prior: "comparable prior sessions",
    cumulative: "Cumulative off-exchange share",
    noHistory: "Historical ruler not yet qualified",
    stale: "History stale after source correction",
    pending: "Historical calibration pending",
    partial: "Partial RTH session — daily ranks withheld",
    noProvisional: "Provisional source not supplied",
    sourceAge: "source age",
    sourceHold: "Unverified original receipt",
    atsUnavailable: "Delayed FINRA ATS attribution is not supplied here",
    eodSeparate: "Existing EOD context is separate",
    atsWhy: "A live TRF reporting pipe is not a named ATS or institutional buyer.",
    research: "NBBO research context",
    researchOnly: "Quote-location proxy only",
    noEdge: "No validated directional edge",
    withheld: "R0 context withheld",
    noResearch: "No qualified R0 pressure context",
    balance: "Pressure balance",
    coverage: "Classified notional share",
    disclosure: "Observations only. Venue identity, corrections, source rights, and live capture require original-owner evidence. No trading or alert authority.",
    noRank: "Insufficient observed history",
  },
  zh: {
    title: "盘外成交情报",
    subtitle: "基于来源的研究 · 原始数据尚未认证",
    restricted: "需要私人数据访问权限",
    restrictedWhy: "仅授权的服务器会话可查看私人市场数据。",
    live: "临时成交样本",
    history: "历史参照",
    delayed: "延迟 ATS",
    unavailable: "数据来源暂不可用",
    notZero: "不代表市场没有成交",
    raw: "临时 TRF 总额（含所有条件）",
    sample: "样本：交易所 / TRF 笔数",
    notComparable: "不能与历史合格成交总额相加比较",
    individual: "单笔成交",
    cluster: "同价位成交簇",
    total: "当日样本总额",
    ruler: "仅限可比样本历史，不代表历史最高",
    rank: "样本排名",
    minute: "分钟",
    prior: "个可比历史交易日",
    cumulative: "累计盘外成交占比",
    noHistory: "历史参照尚未确认",
    stale: "来源修订后历史参照已过期",
    pending: "历史校准仍在进行",
    partial: "交易日尚未结束，暂不提供整日排名",
    noProvisional: "临时来源尚未提供",
    sourceAge: "来源时间",
    sourceHold: "原始成交回执尚未认证",
    atsUnavailable: "此处尚无延迟 FINRA ATS 机构归属数据",
    eodSeparate: "原有日终数据独立显示",
    atsWhy: "实时 TRF 报送渠道不代表具体 ATS 或机构买家。",
    research: "NBBO 研究上下文",
    researchOnly: "仅为报价位置的描述性代理指标",
    noEdge: "没有经过验证的方向性优势",
    withheld: "已隐藏不匹配的 R0 上下文",
    noResearch: "暂无合格的 R0 压力研究数据",
    balance: "压力平衡代理值",
    coverage: "已分类成交额占比",
    disclosure: "仅供观测研究。场所归属、修订、授权及实时覆盖需要原始来源核验，不构成交易或警报依据。",
    noRank: "可比历史样本不足",
  },
} as const;

const COLORS = {
  shell: { backgroundColor: "var(--panel)", color: "var(--text)",
    borderColor: "var(--line)" } as React.CSSProperties,
  card: { backgroundColor: "var(--panel-2)", borderColor: "var(--line)" } as React.CSSProperties,
  mute: { color: "var(--text-2)" } as React.CSSProperties,
  faded: { color: "var(--muted)" } as React.CSSProperties,
  num: { color: "var(--text)", fontFamily: "var(--font-num)",
    fontVariantNumeric: "tabular-nums" as const } as React.CSSProperties,
  warning: { color: "var(--warn)" } as React.CSSProperties,
};

function money(value: string | null, lang: Lang): string {
  if (value===null) return "—";
  const [whole, fraction=""]=value.split(".");
  // Use original fixed-point text; Number would silently round larger values.
  const grouped=BigInt(whole).toLocaleString(lang==="zh"?"en-US":"en-US");
  return "$"+grouped+(fraction?"."+fraction:"");
}
/** Compact display rounding uses exact integer math, never float conversion.
 * Source precision remains unchanged in the decoded object and tooltip.
 */
function compactDecimal(value: string | null, multiplier: bigint, places: number): string {
  if(value===null) return "—";
  const minus=value.startsWith("-");
  const [whole, fraction=""]=(minus?value.slice(1):value).split(".");
  const original=BigInt(whole+fraction);
  const denominator=BigInt(10)**BigInt(fraction.length);
  const precision=BigInt(10)**BigInt(places);
  const numerator=original*multiplier*precision;
  const rounded=(numerator*BigInt(2)+denominator)/(denominator*BigInt(2));
  if(original>BigInt(0) && rounded===BigInt(0)) return "≈0";
  const integer=rounded/precision;
  const remainder=(rounded%precision).toString().padStart(places,"0").replace(/0+$/,"");
  return (minus&&rounded!==BigInt(0)?"-":"")+integer.toString()+
    (remainder?"."+remainder:"");
}
function percent(value: string | null): string {
  if(value===null) return "—";
  const [whole, fraction=""]=value.split(".");
  const magnitude=BigInt(whole+fraction);
  const denominator=BigInt(10)**BigInt(fraction.length);
  const compact=compactDecimal(value,BigInt(100),1);
  // Do not make a tiny nonzero fraction look like zero, or 99.95%
  // coverage look like mathematically complete 100%.
  if(magnitude>BigInt(0)&&compact==="≈0") return "<0.1%";
  if(magnitude<denominator&&compact==="100") return ">99.9%";
  return compact+"%";
}
function stamp(value: bigint | null, lang: Lang): string | null {
  if(value===null) return null;
  // Display-only truncation after exact bigint contract validation. NEVER
  // return display milliseconds into source as-of, replay or receipt pairing.
  const millis=Number(value/BigInt(1000000));
  if(!Number.isSafeInteger(millis)) return value.toString()+" ns";
  return new Intl.DateTimeFormat(lang==="zh"?"zh-CN":"en-US", {
    timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric",
    hour:"2-digit",minute:"2-digit",hour12:false,
  }).format(new Date(millis))+" America/New_York";
}
function panelHeading(title: string, number: string) {
  return (
    <header className="mb-3 flex items-center justify-between gap-3">
      <h3 className="min-w-0 text-xs font-semibold tracking-wide">{title}</h3>
      <span className="shrink-0 text-[10px] tabular-nums" style={COLORS.faded}>{number}</span>
    </header>
  );
}
function Metric({label,value}:Readonly<{label:string;value:string}>) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] leading-4" style={COLORS.mute}>{label}</span>
      <span className="block break-all text-base font-semibold leading-6" style={COLORS.num}
        title={value}>{value}</span>
    </div>
  );
}

export function Tp2ResearchReadout({evidence,r0,lang,privateViewAuthorized}:Props) {
  const t=WORDS[lang];
  if(!privateViewAuthorized) {
    return (
      <section data-testid="tp2-private-gated" role="status"
        aria-label={t.title} className="rounded-lg border p-5"
        style={COLORS.shell}>
        <h2 className="text-sm font-semibold">{t.restricted}</h2>
        <p className="mt-2 text-xs" style={COLORS.mute}>{t.restrictedWhy}</p>
      </section>
    );
  }
  const s=evidence;
  // Without a TP-B ticker/session anchor, displaying a free-standing R0
  // sidecar could put another symbol's pressure proxy in this readout.
  // Refuse to surface it until the two source identities can be compared.
  const compatibleR0 = r0!==null && s!==null && s.ticker!==null &&
    s.session!==null && r0.ticker===s.ticker && r0.session===s.session &&
    r0.viewAsOfNs<=s.viewAsOfNs;
  const r0View=compatibleR0?r0:null;
  const r0Mismatch=r0!==null && !compatibleR0;
  const sourceStamp=stamp(s?.observationAsOfNs??null,lang);
  const dailyRank=s?.ranks?.DAILY_TOTAL;
  const observed=s?.observed;
  const historyFlag = s?.state==="CALIBRATION_STALE_SOURCE_GENERATION" ? t.stale
    : s?.state==="HISTORICAL_CALIBRATION_PENDING" ||
      s?.state==="CALIBRATION_NOT_YET_KNOWABLE" ? t.pending
    : observed && !observed.fullRthCoveredClaimUnverified ? t.partial
    : null;
  const tp1=s?.provisional;
  return (
    <section data-testid="tp2-private-research"
      aria-label={t.title} className="min-w-0 rounded-lg border p-4 md:p-5"
      style={COLORS.shell}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4"
        style={{borderColor:"var(--line)"}}>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em]"
            style={COLORS.faded}>Mastermind Terminal / Private research</p>
          <h2 className="text-base font-bold tracking-tight md:text-lg">{t.title}</h2>
          <p className="mt-1 text-xs" style={COLORS.mute}>{t.subtitle}</p>
        </div>
        <div className="max-w-full rounded border px-3 py-2 text-right text-[11px]"
          style={{borderColor:"var(--line)",color:"var(--text-2)"}}>
          <span className="block font-semibold">{s?.ticker??t.unavailable}</span>
          <span className="block" title={s?.observationAsOfNs?.toString()}>
            {t.sourceAge} · {sourceStamp??"—"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section aria-label={t.live} data-testid="tp2-provisional"
          className="min-w-0 rounded-md border p-3" style={COLORS.card}>
          {panelHeading(t.live,"01 / TQ")}
          {tp1 ? (
            <>
              <Metric label={t.raw} value={money(tp1.trfAnyConditionNotionalUsd,lang)}/>
              <div className="mt-3 flex flex-wrap items-baseline gap-2">
                <span className="text-[11px]" style={COLORS.mute}>{t.sample}</span>
                <strong className="text-sm tabular-nums" style={COLORS.num}>
                  {tp1.sampledLitPrints} / {tp1.sampledTrfPrints}
                </strong>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={COLORS.warning}>{t.notComparable}</p>
              <p className="mt-2 text-[10px]" style={COLORS.mute}>
                {t.sourceAge} · {stamp(tp1.minuteDecisionNs,lang)}
              </p>
            </>
          ):(
            <p className="text-xs leading-relaxed" role="status" style={COLORS.mute}>
              {t.noProvisional}. {t.notZero}.
            </p>
          )}
        </section>

        <section aria-label={t.history} data-testid="tp2-history"
          className="min-w-0 rounded-md border p-3" style={COLORS.card}>
          {panelHeading(t.history,"02 / RTH")}
          {historyFlag && (
            <p data-testid="tp2-history-state" role="status"
              className="mb-3 text-xs leading-relaxed" style={COLORS.warning}>
              {historyFlag}
            </p>
          )}
          {observed ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric label={t.individual} value={money(observed.individualPrintUsd,lang)}/>
                <Metric label={t.cluster} value={money(observed.sameLevelClusterUsd,lang)}/>
                <div className="col-span-2">
                  <Metric label={t.total} value={money(observed.rthTotalUsd,lang)}/>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed" style={COLORS.mute}>{t.ruler}</p>
              {observed.fullRthCoveredClaimUnverified &&
                dailyRank?.sampleRank!==null && dailyRank?.sampleRank!==undefined ? (
                <p className="mt-1 text-xs" style={COLORS.num}>
                  {t.rank} <strong>#{dailyRank.sampleRank}</strong>
                  <span style={COLORS.mute}> · {dailyRank.priorN} {t.prior}</span>
                </p>
              ):(
                <p className="mt-1 text-xs" style={COLORS.mute}>
                  {historyFlag ? t.noHistory : t.noRank}
                </p>
              )}
              {s?.minuteBaseline && (
                <p className="mt-2 text-xs" style={COLORS.mute}>
                  {t.minute} {s.minuteBaseline.minuteIndex}
                  <span> · {t.cumulative}: </span>
                  <strong style={COLORS.num}
                    title={s.minuteBaseline.cumulativeOffexchangeShare??undefined}>
                    {percent(s.minuteBaseline.cumulativeOffexchangeShare)}
                  </strong>
                  <span> · {s.minuteBaseline.sampleN} {t.prior}</span>
                </p>
              )}
            </>
          ):(
            <p role="status" className="text-xs leading-relaxed" style={COLORS.mute}>
              {t.unavailable}. {t.notZero}. {t.noHistory}.
            </p>
          )}
        </section>

        <section aria-label={t.delayed} data-testid="tp2-delayed"
          className="min-w-0 rounded-md border p-3" style={COLORS.card}>
          {panelHeading(t.delayed,"03 / FINRA")}
          <p role="status" className="text-sm font-semibold leading-relaxed"
            style={COLORS.mute}>{t.atsUnavailable}</p>
          <p className="mt-3 text-xs leading-relaxed" style={COLORS.faded}>
            {t.eodSeparate}
          </p>
          <p className="mt-3 text-xs leading-relaxed" style={COLORS.warning}>
            {t.atsWhy}
          </p>
        </section>
      </div>

      <aside data-testid="tp2-r0" aria-label={t.research}
        className="mt-3 min-w-0 rounded-md border px-3 py-3"
        style={{borderColor:"var(--line)",backgroundColor:"var(--panel-2)"}}>
        <h3 className="text-xs font-semibold">{t.research}</h3>
        {r0Mismatch ? (
          <p role="status" className="mt-2 text-xs" style={COLORS.mute}>{t.withheld}</p>
        ):r0View?.pressure ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span style={COLORS.mute}>{t.balance}: <strong style={COLORS.num}
              title={r0View.pressure.pressureBalance??undefined}>
              {compactDecimal(r0View.pressure.pressureBalance,BigInt(1),3)}</strong></span>
            <span style={COLORS.mute}>{t.coverage}: <strong style={COLORS.num}
              title={r0View.pressure.coverage??undefined}>
              {percent(r0View.pressure.coverage)}</strong></span>
            <span className="text-[11px]" style={COLORS.warning}>
              {t.researchOnly} · {t.noEdge}</span>
          </div>
        ):(
          <p className="mt-2 text-xs" role="status" style={COLORS.mute}>{t.noResearch}</p>
        )}
      </aside>

      <footer className="mt-3 border-t pt-3 text-[11px] leading-relaxed"
        style={{borderColor:"var(--line)",color:"var(--muted)"}}>
        {t.sourceHold}. {t.disclosure}
      </footer>
    </section>
  );
}
