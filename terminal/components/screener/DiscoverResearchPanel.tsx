"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import AssetLogo from "@/components/AssetLogo";
import { useLang, useT } from "@/lib/i18n";
import { displayName, MARKET_TKEY } from "@/lib/markets";
import { discoverRange, discoverSignal, isDiscoverBuy, type DiscoverRow, type ResearchCondition } from "@/lib/discoverResearch";
import { useResearchT, type ResearchKey } from "@/lib/discoverResearchLex";
import { useDiscoverT } from "@/lib/discoverWorkspaceLex";
import { oracleEntryAvailability } from "@/lib/signalVerdict";
import { discoverOvernightReading, discoverRegularReading } from "@/lib/discoverQuotes";
import { formatMoney, type MoneyCurrency } from "@/lib/crossMarketScreen";
import { FUNDAMENTAL_FIELD_IDS, classifyFundamental, formatFundamentalValue, fundamentalReferenceDate, type FundamentalFieldId, type FundamentalScanSource } from "@/lib/fundamentalScan";
import { fieldName, reasonText, statusText, useFundT } from "@/lib/fundamentalScanLex";
import { classifyTechnical, type TechnicalScanSource } from "@/lib/technicalScan";
import { technicalReasonLabel, technicalSignalLabel, useTechnicalT } from "@/lib/technicalScanLex";
import type { useDiscoverQuotes } from "./useDiscoverQuotes";
import { DiscoverDialog } from "./DiscoverWorkspaceControls";
import styles from "./DiscoverResearch.module.css";

export type { ResearchCondition } from "@/lib/discoverResearch";
export type DiscoverCandidate = { row: DiscoverRow; currency: MoneyCurrency; sector: ReactNode; href: string | null; conditions: ResearchCondition[]; inResults: boolean; available: boolean };
type Props = {
  mode: "inspect" | "compare"; candidates: DiscoverCandidate[]; asOf: string;
  quotes: ReturnType<typeof useDiscoverQuotes>;
  fundamental: { source: FundamentalScanSource | null; nowMs: number; retry: () => void };
  technical: { source: TechnicalScanSource | null; now: number; tf: string; retry: () => void };
  selected: readonly string[]; position: number; total: number;
  onPrevious: (() => void) | null; onNext: (() => void) | null;
  onToggleCompare: (symbol: string) => void; onInspect: (symbol: string) => void;
  onEvidence: (symbol: string, field: FundamentalFieldId, opener: HTMLElement) => void;
  onClose: () => void; returnFocus: () => HTMLElement | null;
  resumeEvidence?: { symbol: string; field: FundamentalFieldId } | null;
};
const number = (v: number | null, lang: string) => v === null ? "—" : v.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 4 : 2 });
const percent = (v: number | null) => v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

export function InspectIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M14 3v7h7M14 3l7 7M7 14h5M7 17h9" /></svg>;
}

export function DiscoverComparisonTray({ rows, onRemove, onClear, onOpen }: { rows: DiscoverRow[]; onRemove: (symbol: string) => void; onClear: () => void; onOpen: () => void }) {
  const rt = useResearchT();
  return <section className={styles.tray} aria-label={rt("compareTitle")} data-discover-compare-tray>
    <div className={styles.trayStocks}><span className={styles.trayCount}>{rt("compareCount", { n: rows.length })}</span>
      {rows.map(row => <button key={row.sym} type="button" className={styles.chip} aria-label={rt("removeSymbol", { sym: row.sym })} onClick={() => onRemove(row.sym)}><AssetLogo symbol={row.sym} name={row.name} market={row.mkt || row.sec} color={row.col} size={20} /><strong>{row.sym}</strong><span aria-hidden="true">×</span></button>)}
    </div>
    <div className={styles.trayActions}><button type="button" className={styles.quiet} onClick={onClear}>{rt("clearCompare")}</button><button type="button" className={styles.primary} disabled={rows.length < 2} onClick={onOpen}>{rt("compare")} <span aria-hidden="true">↗</span></button></div>
  </section>;
}

export default function DiscoverResearchPanel(p: Props) {
  const { lang } = useLang(), t = useT(), rt = useResearchT(), ft = useFundT(), tt = useTechnicalT(), dt = useDiscoverT();
  const isCompare = p.mode === "compare", candidate = p.candidates[0];
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.resumeEvidence) return;
    const target = [...(body.current?.querySelectorAll<HTMLButtonElement>("[data-research-fund]") ?? [])].find(button => button.dataset.researchFund === p.resumeEvidence!.field && button.dataset.researchFundSymbol === p.resumeEvidence!.symbol);
    target?.focus({ preventScroll: true });
  }, [p.resumeEvidence]);
  const entry = oracleEntryAvailability(lang === "zh");
  const time = (ms: number | null) => ms === null ? "—" : new Date(ms).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  const unit = (c: DiscoverCandidate) => c.currency.kind === "code" ? c.currency.code : rt(c.currency.kind === "unknown" ? "currencyUnknown" : "unitNotMoney");
  const regular = (c: DiscoverCandidate) => discoverRegularReading(c.row, p.quotes.regular[c.row.sym], p.quotes.now);
  const overnight = (c: DiscoverCandidate) => discoverOvernightReading(p.quotes.overnight[c.row.sym], p.quotes.now);
  const quoteState = (c: DiscoverCandidate) => {
    const q = regular(c);
    const keys = { snapshot: "priceSnapshot", live: "priceLive", delayed: "priceDelayed", close: "priceClose", quote: "priceQuote" } as const;
    return `${rt(keys[q.kind])} · ${q.kind === "snapshot" ? p.asOf || "—" : time(q.observed)}`;
  };
  const regime = (r: DiscoverRow) => r.regimeBull === null ? rt("unavailable") : rt(r.regimeBull ? "uptrend" : "mixed");
  const signal = (c: DiscoverCandidate) => {
    const s = discoverSignal(c.row, lang, p.quotes.now);
    return <span className={styles.valueStack}><span data-signal-age={s.age} className={!s.dim ? isDiscoverBuy(c.row.verdict) ? styles.positive : c.row.verdict === "SELL" ? styles.negative : "" : styles.muted}>{s.label}</span><small>{s.date ?? s.ageLabel}{s.date && s.dim ? ` · ${s.ageLabel}` : ""}</small></span>;
  };
  const fundCell = (c: DiscoverCandidate, field: FundamentalFieldId) => {
    if (!p.fundamental.source) return <span className={styles.muted}>{rt("loading")}</span>;
    const data = classifyFundamental(p.fundamental.source, c.row.sym, field, p.fundamental.nowMs);
    const date = fundamentalReferenceDate(field, data), known = data.value !== null;
    const status = statusText(ft, data.coverage.status);
    return <button type="button" className={styles.evidenceValue} data-research-fund={field} data-research-fund-symbol={c.row.sym} aria-label={`${rt("evidence", { sym: c.row.sym, field: fieldName(ft, field) })} · ${known ? formatFundamentalValue(field, data.value!) : rt("unavailable")} · ${date ?? "—"} · ${status}${data.coverage.status !== "evaluated" ? ` · ${reasonText(ft, data.coverage.reason)}` : ""}`} onClick={e => p.onEvidence(c.row.sym, field, e.currentTarget)}>
      <strong className={data.coverage.status !== "evaluated" ? styles.muted : ""}>{known ? formatFundamentalValue(field, data.value!) : "—"}</strong>
      <small>{date ? rt(field === "fund.pe_ttm" ? "asOf" : "fiscalEnd", { date }) : status}</small>
      {data.coverage.status !== "evaluated" && <small>{status} · {reasonText(ft, data.coverage.reason)}</small>}
    </button>;
  };
  const historicalMetrics: [ResearchKey, "wr" | "pf" | "cagr", ResearchKey][] = [["winRate", "wr", "winRateMeaning"], ["profitFactor", "pf", "profitFactorMeaning"], ["cagr", "cagr", "cagrMeaning"]];
  const historicalValue = (r: DiscoverRow, key: "wr" | "pf" | "cagr") => r[key] === null ? "—" : key === "pf" ? number(r[key], lang) : `${(r[key]! * 100).toFixed(1)}%`;
  const priceNode = (c: DiscoverCandidate) => <span className={styles.valueStack}><strong>{number(regular(c).price, lang)} <small>{unit(c)}</small></strong><small>{quoteState(c)}</small></span>;
  const matrix: { key: string; label: string; render: (c: DiscoverCandidate) => ReactNode }[] = [
    { key: "regular", label: rt("regular"), render: priceNode },
    { key: "change", label: rt("change"), render: c => percent(regular(c).change) },
    { key: "overnight", label: rt("overnight"), render: c => { const q = overnight(c); return <span className={styles.valueStack}><strong>{q ? `${number(q.extPrice, lang)} ${unit(c)}` : "—"}</strong><small>{q ? `BOATS · ${time(q.extTs * 1000)}` : rt("overnightMissing")}</small></span>; } },
    { key: "overnightChange", label: rt("overnightChange"), render: c => percent(overnight(c)?.extChg ?? null) },
    { key: "signal", label: rt("signal"), render: signal },
    { key: "entry", label: entry.label, render: () => <span className={styles.muted}>{entry.reason}</span> },
    { key: "regime", label: rt("regime"), render: c => <span className={styles.valueStack}>{regime(c.row)}<small>{p.asOf || "—"}</small></span> },
    { key: "sector", label: rt("sector"), render: c => c.sector },
    { key: "dv", label: rt("liquidity"), render: c => formatMoney(c.row.dv, c.currency) },
    { key: "mcap", label: rt("marketCap"), render: c => formatMoney(c.row.mcap, { kind: "code", code: "USD" }) },
    { key: "offHi", label: rt("offHigh"), render: c => percent(c.row.offHi) },
    ...FUNDAMENTAL_FIELD_IDS.map(field => ({ key: field, label: fieldName(ft, field), render: (c: DiscoverCandidate) => fundCell(c, field) })),
  ];
  const technical = candidate && p.technical.source ? classifyTechnical(p.technical.source, candidate.row.sym, p.technical.tf, p.technical.now) : null;
  const range = candidate ? discoverRange(candidate.row) : null;
  const s = candidate ? discoverSignal(candidate.row, lang, p.quotes.now) : null;
  const meanings = { BUY: "a_confirmed_bullish_momentum_event_in_the", REBUY: "a_fast_bullish_reversal_within_three_3", RECLAIM: "trend_repair_after_an_exit_or_a", SELL: "a_trailing_structure_stop_event_in_the" } as const;
  const meaning = candidate?.row.verdict && candidate.row.verdict in meanings ? dt(meanings[candidate.row.verdict as keyof typeof meanings]) : rt("unavailable");

  const navigation = !isCompare && <nav className={styles.navigation} aria-label={rt("research")}><button type="button" className={styles.arrow} disabled={!p.onPrevious} aria-label={rt("previous")} onClick={() => p.onPrevious?.()}>←</button><span role="status">{candidate?.row.sym} · {p.position >= 0 ? rt("resultPosition", { n: p.position + 1, total: p.total }) : rt("outsideResults")}</span><button type="button" className={styles.arrow} disabled={!p.onNext} aria-label={rt("next")} onClick={() => p.onNext?.()}>→</button></nav>;
  return <DiscoverDialog title={isCompare ? rt("compareTitle") : `${candidate?.row.sym ?? "—"} · ${rt("research")}`} onClose={p.onClose} returnFocus={p.returnFocus} className={isCompare ? styles.compareDialog : styles.inspector} headerContent={navigation}>
    {isCompare ? <div ref={body} className={styles.compareBody} data-discover-comparison>
      <p className={styles.note}>{rt("compareNote")}</p>
      <div className={styles.matrixScroll} tabIndex={0} role="region" aria-label={rt("compareTitle")}><table className={styles.matrix} style={{ minWidth: 180 + p.candidates.length * 200 }}>
        <thead><tr><th scope="col">{rt("compareCount", { n: p.candidates.length })}</th>{p.candidates.map(c => <th key={c.row.sym} scope="col"><button type="button" className={styles.compareIdentity} onClick={() => p.onInspect(c.row.sym)}><AssetLogo symbol={c.row.sym} name={c.row.name} market={c.row.mkt || c.row.sec} color={c.row.col} size={28} /><span><strong>{c.row.sym}</strong><small>{c.available ? displayName(c.row, lang) : rt("missingRow")}</small></span></button><button type="button" className={styles.quiet} aria-label={rt("removeSymbol", { sym: c.row.sym })} onClick={() => p.onToggleCompare(c.row.sym)}>×</button></th>)}</tr></thead>
        <tbody>{matrix.map(metric => <tr key={metric.key}><th scope="row">{metric.label}</th>{p.candidates.map(c => <td key={c.row.sym}>{c.available ? metric.render(c) : "—"}</td>)}</tr>)}</tbody>
      </table></div>
      <details className={styles.history}><summary>{rt("historical")}</summary><p className={styles.note}>{rt("historicalWarning")}</p><div className={styles.matrixScroll}><table className={styles.matrix}><thead><tr><th scope="col">{rt("historical")}</th>{p.candidates.map(c => <th key={c.row.sym} scope="col">{c.row.sym}</th>)}</tr></thead><tbody>{historicalMetrics.map(([label, key, meaning]) => <tr key={key}><th scope="row" title={rt(meaning)}>{rt(label)}</th>{p.candidates.map(c => <td key={c.row.sym}>{historicalValue(c.row, key)}</td>)}</tr>)}</tbody></table></div></details>
      <p className={styles.note}>{rt("quotesNote")} {rt("asOf", { date: p.asOf || "—" })}</p>
    </div> : candidate?.available ? <div ref={body} className={styles.inspectorBody} data-discover-inspector={candidate.row.sym}>
      <div className={styles.identity}><AssetLogo symbol={candidate.row.sym} name={candidate.row.name} market={candidate.row.mkt || candidate.row.sec} color={candidate.row.col} size={40} /><div><h3>{displayName(candidate.row, lang)}</h3><p>{candidate.row.sym} <span>· {t(MARKET_TKEY[candidate.row.mktId])} · {unit(candidate)}</span></p></div></div>
      <div className={styles.actions}>{candidate.href && <Link href={candidate.href} prefetch={false} className={styles.primary}>{rt("openChart")} <span aria-hidden="true">↗</span></Link>}<button type="button" className={styles.secondary} disabled={p.selected.length >= 4 && !p.selected.includes(candidate.row.sym)} aria-pressed={p.selected.includes(candidate.row.sym)} onClick={() => p.onToggleCompare(candidate.row.sym)}>{rt(p.selected.includes(candidate.row.sym) ? "removeCompare" : "addCompare")}</button></div>
      {p.selected.length >= 4 && !p.selected.includes(candidate.row.sym) && <p className={styles.note} role="status">{rt("compareCap")}</p>}
      <section className={styles.quoteGrid} aria-label={rt("regular")}><div><h4>{rt("regular")}</h4><div className={styles.price}>{number(regular(candidate).price, lang)}</div><span className={regular(candidate).change === null ? "" : regular(candidate).change! >= 0 ? styles.positive : styles.negative}>{percent(regular(candidate).change)}</span><p>{quoteState(candidate)}</p>{p.quotes.regularStatus === "unavailable" && <p>{rt("refreshUnavailable")}</p>}</div><div><h4>{rt("overnight")}</h4><div className={styles.overnightPrice}>{number(overnight(candidate)?.extPrice ?? null, lang)}</div><span>{percent(overnight(candidate)?.extChg ?? null)}</span><p>{overnight(candidate) ? `BOATS · ${time(overnight(candidate)!.extTs * 1000)}` : rt("overnightMissing")}</p>{p.quotes.overnightStatus === "unavailable" && <p>{rt("refreshUnavailable")}</p>}</div></section>
      <p className={styles.note}>{rt("quotesNote")}</p>
      <section className={styles.section}><div className={styles.sectionHeading}><h3>{rt("signal")}</h3><span className={styles.entry} title={entry.reason}>{entry.label}</span></div><div className={styles.signalGrid}><div>{signal(candidate)}<p className={styles.note}>{meaning}</p></div><div><small>{rt("regime")}</small><strong>{regime(candidate.row)}</strong><small>{p.asOf || "—"}</small></div></div><p className={styles.note}>{rt("signalNote")}{s?.dim && s.age === "historical" ? ` ${rt("historicalNote")}` : ""}</p></section>
      <section className={styles.section}><h3>{rt(candidate.inResults ? "matches" : "conditions")}</h3><p className={styles.note}>{rt("matchNote", { date: p.asOf || "—" })}</p><ul className={styles.conditions}>{candidate.conditions.map((condition, i) => <li key={`${condition.label}:${i}`} data-match={condition.match} data-admitted-unknown={condition.admittedUnknown || undefined}><span className={styles.conditionState} title={rt(condition.admittedUnknown ? "admittedUnknown" : condition.match)} aria-label={rt(condition.admittedUnknown ? "admittedUnknown" : condition.match)}>{condition.admittedUnknown ? "?" : condition.match === "pass" ? "✓" : condition.match === "fail" ? "×" : "?"}</span><span><strong>{condition.label}</strong><small>{condition.value}</small></span></li>)}</ul></section>
      <section className={styles.section}><h3>{rt("range")}</h3>{range !== null && <><div className={styles.rangeTrack}><span style={{ left: `${Math.max(0, Math.min(100, range))}%` }} /></div><div className={styles.rangeEnds}><span>{number(candidate.row.lo52, lang)}</span><span>{number(candidate.row.hi52, lang)} {unit(candidate)}</span></div><p className={styles.note}>{range < 0 || range > 100 ? rt("rangeOutside") : rt("rangePosition", { n: range.toFixed(0) })}</p></>}<dl className={styles.facts}><dt>{rt("scanPrice")}</dt><dd>{number(candidate.row.last, lang)} {unit(candidate)}</dd><dt>{rt("offHigh")}</dt><dd>{percent(candidate.row.offHi)}</dd><dt>{rt("liquidity")}</dt><dd>{formatMoney(candidate.row.dv, candidate.currency)}</dd><dt>{rt("marketCap")}</dt><dd>{formatMoney(candidate.row.mcap, { kind: "code", code: "USD" })}</dd><dt>{rt("sector")}</dt><dd>{candidate.sector}</dd></dl></section>
      <section className={styles.section}><h3>{rt("technical")} · {p.technical.tf}</h3>{technical ? <><dl className={styles.facts}><dt>{tt("tsPosition")}</dt><dd>{technical.observation?.state.position_hint === "long" ? tt("tsLong") : technical.observation?.state.position_hint === "flat" ? tt("tsFlat") : "—"}</dd><dt>{tt("tsLastSignal")}</dt><dd>{technical.observation?.state.last_signal ? technicalSignalLabel(technical.observation.state.last_signal, lang) : "—"}</dd><dt>{rt("period")}</dt><dd>{technical.observation?.cutoff.bar_open ?? "—"}</dd></dl><p className={styles.note}>{statusText(ft, technical.coverage.status)}{technical.coverage.status !== "evaluated" ? ` · ${technicalReasonLabel(technical.coverage.reason, lang)}` : ""}{technical.observation?.cutoff.bar_closed === false ? ` · ${tt("tsFormingCell")}` : ""}</p></> : <p className={styles.note}>{rt("loading")}</p>}{p.technical.source?.kind === "error" && <button type="button" className={styles.quiet} onClick={p.technical.retry}>{rt("retry")}</button>}</section>
      <section className={styles.section}><h3>{rt("fundamentals")}</h3><dl className={styles.fundGrid}>{FUNDAMENTAL_FIELD_IDS.map(field => <Fragment key={field}><dt>{fieldName(ft, field)}</dt><dd>{fundCell(candidate, field)}</dd></Fragment>)}</dl>{p.fundamental.source?.kind === "error" && <button type="button" className={styles.quiet} onClick={p.fundamental.retry}>{rt("retry")}</button>}</section>
      <details className={styles.history}><summary>{rt("historical")}</summary><p className={styles.note}>{rt("historicalWarning")}</p><dl className={styles.historyMetrics}>{historicalMetrics.map(([label, key, meaning]) => <Fragment key={key}><dt>{rt(label)}<small>{rt(meaning)}</small></dt><dd>{historicalValue(candidate.row, key)}</dd></Fragment>)}</dl></details>
    </div> : <p className={styles.empty}>{rt("missingRow")}</p>}
  </DiscoverDialog>;
}
